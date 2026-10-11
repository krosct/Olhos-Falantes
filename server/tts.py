from __future__ import annotations

import hashlib
import io
import logging
import re
import time
import wave
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from threading import Lock
from typing import Any

import httpx

from .config import Settings

CLOUD_PREFIX = "cloud:"
MAX_CACHED_CHARS = 300
MAX_CACHED_FILES_PER_VOICE = 300
RETRY_DELAYS_S = (1.5, 3.0)
TRANSIENT_STATUS = frozenset({408, 429, 500, 502, 503, 504})
MAX_ERROR_DETAIL = 200

_PIPER_NAME = re.compile(r"^[a-z]{2,3}_[A-Z]{2}-([A-Za-z0-9_]+)-(x_low|low|medium|high)$")
_SECRET_LIKE = re.compile(r"(sk|key|AIza)[-_A-Za-z0-9*.]{8,}", re.IGNORECASE)
_MEDIA_TYPES = {".wav": "audio/wav", ".mp3": "audio/mpeg"}

logger = logging.getLogger("olhos_falantes")

_loaded: dict[Path, Any] = {}
_lock = Lock()


class TtsError(RuntimeError):
    def __init__(self, message: str, user_message: str = "", retryable: bool = False) -> None:
        super().__init__(message)
        self.user_message = user_message or "A voz escolhida não está disponível agora."
        self.retryable = retryable


@dataclass(frozen=True)
class Voice:
    id: str
    label: str
    group: str
    folder: str


@dataclass(frozen=True)
class Speech:
    audio: bytes
    media_type: str


def list_piper_voices(voices_dir: Path) -> list[str]:
    if not voices_dir.is_dir():
        return []
    return sorted(
        path.stem
        for path in voices_dir.glob("*.onnx")
        if _PIPER_NAME.match(path.stem) and path.with_suffix(".onnx.json").is_file()
    )


def voice_label(voice_id: str) -> str:
    match = _PIPER_NAME.match(voice_id)
    speaker = match.group(1) if match else voice_id
    return speaker.replace("_", " ").title()


def list_voices(settings: Settings) -> list[Voice]:
    voices = [
        Voice(id=voice_id, label=voice_label(voice_id), group="piper", folder=voice_label(voice_id))
        for voice_id in list_piper_voices(settings.piper_voices_dir)
    ]
    if settings.tts_model:
        voices += [
            Voice(id=f"{CLOUD_PREFIX}{voice_id}", label=name, group="cloud", folder=name)
            for voice_id, name in settings.tts_voices
        ]
    return voices


def find_voice(settings: Settings, voice_id: str) -> Voice | None:
    return next((voice for voice in list_voices(settings) if voice.id == voice_id), None)


def _load_piper(path: Path) -> Any:
    voice = _loaded.get(path)
    if voice is not None:
        return voice
    try:
        from piper import PiperVoice
    except ModuleNotFoundError as error:
        raise TtsError("piper-tts nao instalado") from error
    voice = PiperVoice.load(path)
    _loaded[path] = voice
    return voice


def _synthesize_piper(text: str, voice: Voice, settings: Settings) -> Speech:
    path = settings.piper_voices_dir / f"{voice.id}.onnx"
    buffer = io.BytesIO()
    try:
        with _lock:
            model = _load_piper(path)
            with wave.open(buffer, "wb") as wav:
                model.synthesize_wav(text, wav)
    except TtsError:
        raise
    except Exception as error:
        raise TtsError("falha ao gerar o audio com o Piper") from error
    return Speech(buffer.getvalue(), "audio/wav")


def _error_detail(response: httpx.Response) -> str:
    try:
        error = response.json().get("error", {})
        message = str(error.get("message", "")) if isinstance(error, dict) else ""
    except (ValueError, AttributeError):
        message = ""
    return _SECRET_LIKE.sub("[oculto]", message)[:MAX_ERROR_DETAIL] or "sem detalhes"


def _cloud_error(response: httpx.Response, voice: Voice, settings: Settings) -> TtsError:
    status = response.status_code
    detail = _error_detail(response)
    if status == 400:
        return TtsError(
            f"o modelo {settings.tts_model} recusou a voz {voice.label} ({voice.id.removeprefix(CLOUD_PREFIX)}): "
            f"400 {detail}. Confira TTS_MODEL e TTS_MODEL_IDS.",
            user_message=f"A voz {voice.label} não funciona com o modelo de voz configurado.",
        )
    if status == 404:
        return TtsError(
            f"modelo de voz {settings.tts_model} nao encontrado: 404 {detail}. Confira TTS_MODEL.",
            user_message="O modelo de voz configurado não existe.",
        )
    return TtsError(
        f"servico de voz respondeu {status}: {detail}",
        user_message=f"A voz {voice.label} não está disponível agora.",
        retryable=status in TRANSIENT_STATUS,
    )


def _synthesize_cloud_once(text: str, voice: Voice, settings: Settings, client: httpx.Client | None) -> Speech:
    payload = {
        "model": settings.tts_model,
        "input": text,
        "voice": voice.id.removeprefix(CLOUD_PREFIX),
        "response_format": "mp3",
    }
    headers = {"Authorization": f"Bearer {settings.tts_api_key}", "Content-Type": "application/json"}
    owns_client = client is None
    active = client or httpx.Client(timeout=settings.tts_timeout_s)
    try:
        response = active.post(f"{settings.tts_api_base}/audio/speech", headers=headers, json=payload)
    except httpx.HTTPError as error:
        raise TtsError("falha de rede com o servico de voz", retryable=True) from error
    finally:
        if owns_client:
            active.close()
    if response.status_code >= 400:
        raise _cloud_error(response, voice, settings)
    content_type = response.headers.get("content-type", "")
    if not content_type.startswith("audio/") or not response.content:
        raise TtsError(f"servico de voz nao devolveu audio ({content_type or 'sem tipo'})", retryable=True)
    return Speech(response.content, "audio/mpeg")


def _synthesize_cloud(
    text: str,
    voice: Voice,
    settings: Settings,
    client: httpx.Client | None,
    sleep: Callable[[float], None],
) -> Speech:
    if not settings.tts_api_key:
        raise TtsError("TTS_API_KEY/VISION_API_KEY nao configurada")
    attempts = len(RETRY_DELAYS_S) + 1
    for attempt in range(1, attempts + 1):
        try:
            return _synthesize_cloud_once(text, voice, settings, client)
        except TtsError as error:
            if not error.retryable or attempt == attempts:
                raise
            logger.warning("tts attempt %d of %d failed, retrying: %s", attempt, attempts, error)
            sleep(RETRY_DELAYS_S[attempt - 1])
    raise TtsError("tentativas esgotadas")


def _cache_path(text: str, voice: Voice, settings: Settings) -> Path:
    engine = settings.tts_model if voice.group == "cloud" else "piper"
    key = hashlib.sha256(f"{engine}\n{voice.id}\n{text}".encode()).hexdigest()[:32]
    suffix = ".mp3" if voice.group == "cloud" else ".wav"
    return settings.audio_cache_dir / voice.folder / f"{key}{suffix}"


def _store(path: Path, audio: bytes) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        if sum(1 for _ in path.parent.iterdir()) >= MAX_CACHED_FILES_PER_VOICE:
            return
        temporary = path.with_name(f"{path.name}.tmp")
        temporary.write_bytes(audio)
        temporary.replace(path)
    except OSError as error:
        logger.warning("could not cache audio %s: %s", path, error)


def synthesize(
    text: str,
    voice_id: str,
    settings: Settings,
    cache: bool = False,
    client: httpx.Client | None = None,
    sleep: Callable[[float], None] = time.sleep,
) -> Speech:
    voice = find_voice(settings, voice_id)
    if voice is None:
        raise TtsError(f"voz indisponivel: {voice_id}")
    cacheable = cache and len(text) <= MAX_CACHED_CHARS
    path = _cache_path(text, voice, settings) if cacheable else None
    if path is not None and path.is_file():
        return Speech(path.read_bytes(), _MEDIA_TYPES[path.suffix])
    if voice.group == "cloud":
        speech = _synthesize_cloud(text, voice, settings, client, sleep)
    else:
        speech = _synthesize_piper(text, voice, settings)
    if path is not None:
        _store(path, speech.audio)
    return speech
