from __future__ import annotations

import dataclasses
import math

from . import tts, vendor
from .config import Settings
from .prompt import DETAIL_LEVELS

DEVICE_VOICE = "device"

LIMITS: dict[str, tuple[float, float]] = {
    "confidenceThreshold": (0.0, 1.0),
    "visionTimeoutConnection": (1.0, 60.0),
    "visionTimeoutRequest": (5.0, 300.0),
    "visionAttempts": (1.0, 30.0),
    "ttsTimeout": (1.0, 120.0),
}


def clamp(key: str, value: float | None, fallback: float) -> float:
    if value is None or not math.isfinite(value):
        return fallback
    low, high = LIMITS[key]
    return min(high, max(low, value))


def clamp_attempts(value: float | None, fallback: int) -> int:
    chosen = float(fallback) if value is None or not math.isfinite(value) else float(value)
    return round(clamp("visionAttempts", chosen, 3.0))


def public_defaults(settings: Settings) -> dict[str, object]:
    voice_ids = {voice.id for voice in tts.list_voices(settings)}
    voice = settings.default_voice if settings.default_voice in voice_ids else DEVICE_VOICE
    detail = settings.default_detail if settings.default_detail in DETAIL_LEVELS else "medium"
    return {
        "detail": detail,
        "people": settings.default_people,
        "voice": voice,
        "confidenceThreshold": clamp("confidenceThreshold", settings.confidence_threshold, 0.35),
        "visionTimeoutConnection": clamp("visionTimeoutConnection", settings.vision_timeout_connection_s, 10.0),
        "visionTimeoutRequest": clamp("visionTimeoutRequest", settings.vision_timeout_request_s, 60.0),
        "ttsTimeout": clamp("ttsTimeout", settings.tts_timeout_s, 20.0),
        "visionAttempts": clamp_attempts(settings.vision_attempts, 3),
    }


def public_config(settings: Settings) -> dict[str, object]:
    return {
        "defaults": public_defaults(settings),
        "limits": {key: {"min": low, "max": high} for key, (low, high) in LIMITS.items()},
        "visionRetryDelay": {"base": vendor.RETRY_BASE_DELAY_S, "max": vendor.RETRY_MAX_DELAY_S},
        "ttsRetryDelays": list(tts.RETRY_DELAYS_S),
    }


def with_vision_overrides(
    settings: Settings,
    confidence_threshold: float | None,
    timeout_connection: float | None,
    timeout_request: float | None,
    attempts: float | None = None,
) -> Settings:
    return dataclasses.replace(
        settings,
        confidence_threshold=clamp("confidenceThreshold", confidence_threshold, settings.confidence_threshold),
        vision_timeout_connection_s=clamp(
            "visionTimeoutConnection", timeout_connection, settings.vision_timeout_connection_s
        ),
        vision_timeout_request_s=clamp("visionTimeoutRequest", timeout_request, settings.vision_timeout_request_s),
        vision_attempts=clamp_attempts(attempts, settings.vision_attempts),
    )


def with_tts_overrides(settings: Settings, tts_timeout: float | None) -> Settings:
    return dataclasses.replace(settings, tts_timeout_s=clamp("ttsTimeout", tts_timeout, settings.tts_timeout_s))
