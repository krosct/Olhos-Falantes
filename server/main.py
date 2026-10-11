from __future__ import annotations

import logging
from functools import partial

from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from . import tts, user_settings, vendor
from .config import get_settings
from .imaging import is_jpeg, strip_jpeg_metadata
from .prompt import DEFAULT_DETAIL, DETAIL_LEVELS, build_prompt
from .ratelimit import limiter, speak_limiter

logger = logging.getLogger("olhos_falantes")

UNUSABLE_MESSAGE = "A foto não ficou boa. Tente outra, de preferência com mais luz e sem tremer."
VENDOR_DOWN_MESSAGE = "Não consegui falar com o serviço de descrição agora. Tente de novo em instantes."
RATE_MESSAGE = "Muitas tentativas em pouco tempo. Espere um instante e tente de novo."
BAD_IMAGE_MESSAGE = "Não recebi uma foto válida. Tente novamente."
READY_MESSAGE = "Descrição pronta."

app = FastAPI(title="Olhos Falantes", docs_url=None, redoc_url=None, openapi_url=None)


class SpeakRequest(BaseModel):
    text: str
    voice: str | None = None
    cache: bool = False
    tts_timeout: float | None = None


class DescribeResponse(BaseModel):
    ok: bool
    confidence: float
    description: str
    user_message: str
    retry: bool


def _json(payload: DescribeResponse, status_code: int = 200) -> JSONResponse:
    return JSONResponse(payload.model_dump(), status_code=status_code)


@app.get("/api/config")
def config() -> dict[str, object]:
    return user_settings.public_config(get_settings())


@app.get("/api/health")
def health() -> dict[str, bool]:
    return {"ok": True}


@app.post("/api/describe")
async def describe(
    request: Request,
    image: UploadFile = File(...),
    mode: str = Form("scene"),
    detail: str = Form(DEFAULT_DETAIL),
    people: bool = Form(False),
    confidence_threshold: float | None = Form(None),
    timeout_connection: float | None = Form(None),
    timeout_request: float | None = Form(None),
    attempts: float | None = Form(None),
):
    settings = user_settings.with_vision_overrides(
        get_settings(), confidence_threshold, timeout_connection, timeout_request, attempts
    )
    client_host = request.client.host if request.client else "unknown"
    if not limiter.allow(client_host):
        return _json(
            DescribeResponse(ok=False, confidence=0.0, description="", user_message=RATE_MESSAGE, retry=True),
            429,
        )
    data = await image.read()
    if not data or not is_jpeg(data) or len(data) > settings.max_image_bytes:
        return _json(
            DescribeResponse(ok=False, confidence=0.0, description="", user_message=BAD_IMAGE_MESSAGE, retry=True),
            400,
        )
    stripped = strip_jpeg_metadata(data)
    try:
        prompt = build_prompt(detail if detail in DETAIL_LEVELS else DEFAULT_DETAIL, people)
        description, confidence = await run_in_threadpool(
            partial(vendor.describe_image, stripped, settings, prompt=prompt)
        )
    except vendor.VendorError as error:
        logger.warning("vendor failure during describe: %s", error)
        return _json(
            DescribeResponse(ok=False, confidence=0.0, description="", user_message=VENDOR_DOWN_MESSAGE, retry=True),
            502,
        )
    confidence = max(0.0, min(1.0, confidence))
    if not description.strip() or confidence < settings.confidence_threshold:
        return _json(
            DescribeResponse(ok=True, confidence=confidence, description="", user_message=UNUSABLE_MESSAGE, retry=True)
        )
    return _json(
        DescribeResponse(
            ok=True,
            confidence=confidence,
            description=description.strip(),
            user_message=READY_MESSAGE,
            retry=False,
        )
    )


@app.get("/api/voices")
def voices() -> dict[str, object]:
    settings = get_settings()
    available = tts.list_voices(settings)
    ids = [voice.id for voice in available]
    default = settings.piper_default_voice if settings.piper_default_voice in ids else None
    return {
        "voices": [{"id": voice.id, "label": voice.label, "group": voice.group} for voice in available],
        "default": default or (ids[0] if ids else None),
    }


@app.post("/api/speak")
def speak(request: Request, body: SpeakRequest) -> Response:
    settings = user_settings.with_tts_overrides(get_settings(), body.tts_timeout)
    client_host = request.client.host if request.client else "unknown"
    if not speak_limiter.allow(client_host):
        return JSONResponse({"ok": False, "user_message": RATE_MESSAGE}, status_code=429)
    text = body.text.strip()
    if not text or len(text) > settings.max_speak_chars:
        return JSONResponse({"ok": False, "user_message": "Texto inválido para falar."}, status_code=400)
    voice_id = body.voice or settings.piper_default_voice
    try:
        speech = tts.synthesize(text, voice_id, settings, cache=body.cache)
    except tts.TtsError as error:
        logger.warning("tts failure: %s", error)
        return JSONResponse({"ok": False, "user_message": error.user_message}, status_code=503)
    return Response(content=speech.audio, media_type=speech.media_type, headers={"Cache-Control": "no-store"})
