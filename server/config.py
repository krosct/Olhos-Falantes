from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = PROJECT_ROOT / ".env"

_loaded_env_file = False


def load_env_file() -> None:
    global _loaded_env_file
    if _loaded_env_file:
        return
    _loaded_env_file = True
    if not ENV_FILE.is_file():
        return
    try:
        from dotenv import load_dotenv

        load_dotenv(ENV_FILE, override=False)
        return
    except ModuleNotFoundError:
        pass
    for raw_line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            os.environ.setdefault(key, value)


@dataclass(frozen=True)
class Settings:
    vision_api_key: str
    vision_api_base: str
    vision_model: str
    confidence_threshold: float
    vision_timeout_connection_s: float
    vision_timeout_request_s: float
    vision_attempts: int
    rate_limit: int
    rate_window_s: float
    max_image_bytes: int
    piper_voices_dir: Path
    piper_default_voice: str
    speak_rate_limit: int
    max_speak_chars: int
    tts_model: str
    tts_voices: tuple[tuple[str, str], ...]
    tts_api_base: str
    tts_api_key: str
    tts_timeout_s: float
    audio_cache_dir: Path
    default_detail: str
    default_people: bool
    default_voice: str


_VOICE_PART = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def _parse_tts_voices(raw: str) -> tuple[tuple[str, str], ...]:
    voices: list[tuple[str, str]] = []
    for entry in raw.split(","):
        voice_id, _, name = entry.strip().partition(":")
        voice_id, name = voice_id.strip(), name.strip()
        if _VOICE_PART.match(voice_id) and _VOICE_PART.match(name):
            voices.append((voice_id, name))
    return tuple(voices)


def _normalize_api_base(value: str) -> str:
    base = value.strip().rstrip("/")
    return base.removesuffix("/chat/completions")


def get_settings() -> Settings:
    load_env_file()
    return Settings(
        vision_api_key=os.environ.get("VISION_API_KEY", "").strip(),
        vision_api_base=_normalize_api_base(os.environ.get("VISION_API_BASE", "https://api.openai.com/v1")),
        vision_model=os.environ.get("VISION_MODEL", "gpt-4o-mini").strip(),
        confidence_threshold=float(os.environ.get("CONFIDENCE_THRESHOLD", "0.35")),
        vision_timeout_connection_s=float(os.environ.get("VISION_TIMEOUT_CONNECTION", "10")),
        vision_timeout_request_s=float(os.environ.get("VISION_TIMEOUT_REQUEST", "60")),
        vision_attempts=int(float(os.environ.get("VISION_ATTEMPTS", "3"))),
        rate_limit=int(os.environ.get("RATE_LIMIT_PER_MINUTE", "10")),
        rate_window_s=float(os.environ.get("RATE_WINDOW_S", "60")),
        max_image_bytes=int(os.environ.get("MAX_IMAGE_BYTES", "1500000")),
        piper_voices_dir=PROJECT_ROOT / os.environ.get("PIPER_VOICES_DIR", "models/piper"),
        piper_default_voice=os.environ.get("PIPER_VOICE", "pt_BR-faber-medium").strip(),
        speak_rate_limit=int(os.environ.get("SPEAK_RATE_LIMIT_PER_MINUTE", "60")),
        max_speak_chars=int(os.environ.get("MAX_SPEAK_CHARS", "4000")),
        tts_model=os.environ.get("TTS_MODEL", "").strip(),
        tts_voices=_parse_tts_voices(os.environ.get("TTS_MODEL_IDS", "")),
        tts_api_base=_normalize_api_base(
            os.environ.get("TTS_API_BASE") or os.environ.get("VISION_API_BASE", "https://openrouter.ai/api/v1")
        ).removesuffix("/audio/speech"),
        tts_api_key=(os.environ.get("TTS_API_KEY") or os.environ.get("VISION_API_KEY", "")).strip(),
        tts_timeout_s=float(os.environ.get("TTS_TIMEOUT_S", "20")),
        audio_cache_dir=PROJECT_ROOT / os.environ.get("AUDIO_CACHE_DIR", "audios"),
        default_detail=os.environ.get("DEFAULT_DETAIL", "medium").strip(),
        default_people=os.environ.get("DEFAULT_PEOPLE", "false").strip().lower() in {"1", "true", "yes", "on", "sim"},
        default_voice=os.environ.get("DEFAULT_VOICE", "device").strip(),
    )
