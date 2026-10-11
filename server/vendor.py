from __future__ import annotations

import base64
import json
import logging
import re
import time
from collections.abc import Callable
from typing import Any

import httpx

from .config import Settings
from .prompt import FIXED_PROMPT

DEFAULT_CONFIDENCE = 0.6
MIN_CONFIDENCE = 0.0
MAX_CONFIDENCE = 1.0
_JSON_OBJECT = re.compile(r"\{.*\}", re.DOTALL)
_SECRET_LIKE = re.compile(r"(sk|key|AIza)[-_A-Za-z0-9*.]{8,}", re.IGNORECASE)
MAX_ERROR_DETAIL = 300
MAX_TOKENS = 4000
RETRY_BASE_DELAY_S = 1.5
RETRY_MAX_DELAY_S = 10.0
RETRYABLE_STATUS = frozenset({408, 429, 500, 502, 503, 504})
USER_INSTRUCTION = (
    "Descreva esta foto seguindo as regras. Responda somente com o JSON. "
    "O texto da descrição deve estar obrigatoriamente em português do Brasil."
)

logger = logging.getLogger("olhos_falantes")


class VendorError(RuntimeError):
    def __init__(self, message: str, retryable: bool = False) -> None:
        super().__init__(message)
        self.retryable = retryable


def _image_data_url(image_bytes: bytes, mime: str) -> str:
    encoded = base64.b64encode(image_bytes).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def build_payload(
    model: str, image_bytes: bytes, mime: str = "image/jpeg", prompt: str = FIXED_PROMPT
) -> dict[str, Any]:
    return {
        "model": model,
        "temperature": 0.2,
        "max_tokens": MAX_TOKENS,
        "messages": [
            {"role": "system", "content": prompt},
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": USER_INSTRUCTION,
                    },
                    {"type": "image_url", "image_url": {"url": _image_data_url(image_bytes, mime)}},
                ],
            },
        ],
    }


def extract_content(payload: dict[str, Any]) -> str:
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        error = payload.get("error")
        detail = _redact(json.dumps(error, ensure_ascii=False))[:MAX_ERROR_DETAIL] if error else "vazia"
        raise VendorError(f"resposta do vendor sem choices: {detail}", retryable=_is_transient_body_error(error))
    reason = choices[0].get("finish_reason")
    if reason == "length":
        raise VendorError("resposta do vendor cortada (finish_reason=length)", retryable=True)
    message = choices[0].get("message", {})
    content = message.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = [
            part.get("text", "")
            for part in content
            if isinstance(part, dict) and part.get("type") == "text"
        ]
        return "".join(parts)
    raise VendorError(f"resposta do vendor sem conteudo de texto (finish_reason={reason})", retryable=True)


def _is_transient_body_error(error: Any) -> bool:
    if not isinstance(error, dict):
        return True
    try:
        code = int(error.get("code"))
    except (TypeError, ValueError):
        return True
    return code in RETRYABLE_STATUS or code >= 500


def _clamp(value: Any, fallback: float = DEFAULT_CONFIDENCE) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return max(MIN_CONFIDENCE, min(MAX_CONFIDENCE, number))


def _looks_like_broken_json(text: str) -> bool:
    return text.startswith(("{", "```", "[")) or '"description"' in text


def parse_result(content: str, default_confidence: float = DEFAULT_CONFIDENCE) -> tuple[str, float]:
    parsed: Any = None
    try:
        parsed = json.loads(content)
    except (ValueError, TypeError):
        match = _JSON_OBJECT.search(content or "")
        if match:
            try:
                parsed = json.loads(match.group(0))
            except (ValueError, TypeError):
                parsed = None
    if isinstance(parsed, dict):
        description = str(parsed.get("description", "")).strip()
        confidence = _clamp(parsed.get("confidence"))
    else:
        description = (content or "").strip()
        confidence = default_confidence
        if _looks_like_broken_json(description):
            description = ""
    if not description:
        confidence = min(confidence, 0.1)
    return description, confidence


def _redact(text: str) -> str:
    return _SECRET_LIKE.sub("[oculto]", text)


def _error_code(response: httpx.Response) -> str:
    try:
        body = response.json()
    except ValueError:
        return "sem detalhes"
    if isinstance(body, list) and body:
        body = body[0]
    error = body.get("error") if isinstance(body, dict) else None
    if not isinstance(error, dict):
        return "sem detalhes"
    parts = [
        str(error[key])
        for key in ("code", "status", "type", "message")
        if isinstance(error.get(key), (str, int)) and error.get(key) != ""
    ]
    return _redact(" ".join(parts))[:MAX_ERROR_DETAIL] or "sem detalhes"


def retry_delays(attempts: int) -> list[float]:
    return [min(RETRY_BASE_DELAY_S * 2**index, RETRY_MAX_DELAY_S) for index in range(max(0, attempts - 1))]


def vision_timeout(settings: Settings) -> httpx.Timeout:
    connection = settings.vision_timeout_connection_s
    return httpx.Timeout(connect=connection, write=connection, pool=connection, read=settings.vision_timeout_request_s)


def _describe_once(
    image_bytes: bytes, settings: Settings, client: httpx.Client | None, prompt: str
) -> tuple[str, float]:
    url = f"{settings.vision_api_base}/chat/completions"
    payload = build_payload(settings.vision_model, image_bytes, prompt=prompt)
    headers = {
        "Authorization": f"Bearer {settings.vision_api_key}",
        "Content-Type": "application/json",
    }
    owns_client = client is None
    active = client or httpx.Client(timeout=vision_timeout(settings))
    try:
        response = active.post(url, headers=headers, json=payload)
        if response.status_code >= 400:
            raise VendorError(
                f"vendor respondeu {response.status_code} ({_error_code(response)})",
                retryable=response.status_code in RETRYABLE_STATUS,
            )
        try:
            data = response.json()
        except ValueError as error:
            raise VendorError("resposta do vendor nao era JSON", retryable=True) from error
    except httpx.HTTPError as error:
        raise VendorError("falha de rede com o vendor", retryable=True) from error
    finally:
        if owns_client:
            active.close()
    content = extract_content(data)
    return parse_result(content)


def describe_image(
    image_bytes: bytes,
    settings: Settings,
    client: httpx.Client | None = None,
    sleep: Callable[[float], None] = time.sleep,
    prompt: str = FIXED_PROMPT,
) -> tuple[str, float]:
    if not settings.vision_api_key:
        raise VendorError("VISION_API_KEY nao configurada")
    attempts = max(1, settings.vision_attempts)
    delays = retry_delays(attempts)
    for attempt in range(1, attempts + 1):
        try:
            return _describe_once(image_bytes, settings, client, prompt)
        except VendorError as error:
            if not error.retryable or attempt == attempts:
                raise
            logger.warning("vendor attempt %d of %d failed, retrying: %s", attempt, attempts, error)
            sleep(delays[attempt - 1])
    raise VendorError("tentativas esgotadas")
