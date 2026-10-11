from __future__ import annotations

import dataclasses
import json

import pytest
from fastapi.testclient import TestClient

from server import main as main_module
from server.imaging import is_jpeg, strip_jpeg_metadata


def make_jpeg_with_exif() -> bytes:
    data = bytearray(b"\xff\xd8")
    exif_payload = b"Exif\x00\x00" + b"pretend-exif-data"
    data += b"\xff\xe1" + (len(exif_payload) + 2).to_bytes(2, "big") + exif_payload
    app0_payload = b"JFIF\x00"
    data += b"\xff\xe0" + (len(app0_payload) + 2).to_bytes(2, "big") + app0_payload
    data += b"\xff\xda\x00\x02"
    data += b"\x00\x11\x22"
    data += b"\xff\xd9"
    return bytes(data)


def test_is_jpeg_detects_soi():
    assert is_jpeg(b"\xff\xd8\xff\xd9")
    assert not is_jpeg(b"not a jpeg")
    assert not is_jpeg(b"")


def test_strip_removes_app1_and_keeps_app0():
    stripped = strip_jpeg_metadata(make_jpeg_with_exif())
    assert stripped[:2] == b"\xff\xd8"
    assert stripped.endswith(b"\xff\xd9")
    assert stripped.count(b"\xff\xe1") == 0
    assert b"JFIF" in stripped


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setattr(main_module.limiter, "limit", 1000)
    return TestClient(main_module.app)


def test_describe_success(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        main_module.vendor, "describe_image", lambda data, settings, **_: ("Uma mesa com uma xicara.", 0.9)
    )
    response = client.post("/api/describe", files={"image": ("p.jpg", make_jpeg_with_exif(), "image/jpeg")})
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["retry"] is False
    assert body["description"] == "Uma mesa com uma xicara."
    assert body["confidence"] == pytest.approx(0.9)


def test_describe_low_confidence_asks_retry(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(main_module.vendor, "describe_image", lambda data, settings, **_: ("", 0.05))
    response = client.post("/api/describe", files={"image": ("p.jpg", make_jpeg_with_exif(), "image/jpeg")})
    body = response.json()
    assert body["ok"] is True
    assert body["retry"] is True
    assert body["description"] == ""


def test_describe_rejects_non_jpeg(client: TestClient) -> None:
    response = client.post("/api/describe", files={"image": ("p.txt", b"hello", "text/plain")})
    assert response.status_code == 400
    assert response.json()["ok"] is False


def test_describe_reports_vendor_failure(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(data: bytes, settings: object, **_: object) -> tuple[str, float]:
        raise main_module.vendor.VendorError("down")

    monkeypatch.setattr(main_module.vendor, "describe_image", boom)
    response = client.post("/api/describe", files={"image": ("p.jpg", make_jpeg_with_exif(), "image/jpeg")})
    assert response.status_code == 502
    assert response.json()["ok"] is False


def test_vendor_failure_reason_is_logged(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    def boom(data: bytes, settings: object, **_: object) -> tuple[str, float]:
        raise main_module.vendor.VendorError("vendor respondeu 401 (invalid_api_key)")

    monkeypatch.setattr(main_module.vendor, "describe_image", boom)
    client.post("/api/describe", files={"image": ("p.jpg", make_jpeg_with_exif(), "image/jpeg")})
    assert "401 (invalid_api_key)" in caplog.text


def test_voices_lists_piper_models(client: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    for name in ("pt_BR-faber-medium", "pt_BR-cadu-medium"):
        (tmp_path / f"{name}.onnx").write_bytes(b"")
        (tmp_path / f"{name}.onnx.json").write_text("{}")
    (tmp_path / "pt_BR-orphan-medium.onnx").write_bytes(b"")
    monkeypatch.setenv("PIPER_VOICES_DIR", str(tmp_path))
    monkeypatch.setenv("PIPER_VOICE", "pt_BR-faber-medium")
    monkeypatch.setenv("TTS_MODEL", "")
    body = client.get("/api/voices").json()
    assert [voice["id"] for voice in body["voices"]] == ["pt_BR-cadu-medium", "pt_BR-faber-medium"]
    assert body["voices"][0]["label"] == "Cadu"
    assert body["default"] == "pt_BR-faber-medium"


def test_speak_returns_wav(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(main_module.speak_limiter, "limit", 1000)
    captured: dict[str, str] = {}

    def fake_synthesize(text: str, voice_id: str, settings: object, cache: bool = False):
        captured["text"] = text
        captured["voice"] = voice_id
        return main_module.tts.Speech(b"RIFF-fake-wav", "audio/wav")

    monkeypatch.setattr(main_module.tts, "synthesize", fake_synthesize)
    response = client.post("/api/speak", json={"text": "  Uma mesa.  ", "voice": "pt_BR-cadu-medium"})
    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/wav"
    assert response.content == b"RIFF-fake-wav"
    assert captured == {"text": "Uma mesa.", "voice": "pt_BR-cadu-medium"}


def test_speak_rejects_empty_and_too_long_text(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(main_module.speak_limiter, "limit", 1000)
    assert client.post("/api/speak", json={"text": "   "}).status_code == 400
    assert client.post("/api/speak", json={"text": "a" * 5000}).status_code == 400


def test_speak_unknown_voice_is_unavailable(client: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    monkeypatch.setattr(main_module.speak_limiter, "limit", 1000)
    monkeypatch.setenv("PIPER_VOICES_DIR", str(tmp_path))
    response = client.post("/api/speak", json={"text": "Oi.", "voice": "../../etc/passwd"})
    assert response.status_code == 503


@pytest.mark.parametrize(
    "value",
    [
        "https://openrouter.ai/api/v1",
        "https://openrouter.ai/api/v1/",
        "https://openrouter.ai/api/v1/chat/completions",
    ],
)
def test_api_base_accepts_full_endpoint(monkeypatch: pytest.MonkeyPatch, value: str) -> None:
    from server.config import get_settings

    monkeypatch.setenv("VISION_API_BASE", value)
    assert get_settings().vision_api_base == "https://openrouter.ai/api/v1"


def test_vendor_error_detail_hides_secrets() -> None:
    import httpx

    from server.vendor import _error_code

    response = httpx.Response(
        401,
        json={"error": {"code": 401, "message": "Incorrect API key provided: sk-or-v1-abcdef1234567890"}},
    )
    detail = _error_code(response)
    assert "Incorrect API key" in detail
    assert "abcdef1234567890" not in detail


def test_truncated_json_is_not_read_aloud() -> None:
    from server.vendor import parse_result

    description, confidence = parse_result('```json\n{\n  "description": "A imagem apresenta faixas')
    assert description == ""
    assert confidence <= 0.1


def test_fenced_json_is_parsed() -> None:
    from server.vendor import parse_result

    description, confidence = parse_result('```json\n{"description": "Uma mesa.", "confidence": 0.8}\n```')
    assert description == "Uma mesa."
    assert confidence == pytest.approx(0.8)


def test_plain_text_is_kept() -> None:
    from server.vendor import parse_result

    assert parse_result("Uma mesa com uma xicara.")[0] == "Uma mesa com uma xicara."


def _vendor_settings():
    from server.config import get_settings

    return dataclasses.replace(get_settings(), vision_api_key="test-key", vision_api_base="https://vendor.test/v1")


def _ok_body(text: str = '{"description": "Uma mesa.", "confidence": 0.9}') -> dict:
    return {"choices": [{"finish_reason": "stop", "message": {"content": text}}]}


def _run_vendor(responses: list):
    import httpx

    from server import vendor

    calls: list[str] = []
    delays: list[float] = []
    queue = list(responses)

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(json.loads(request.content)["messages"][1]["content"][0]["text"])
        item = queue.pop(0)
        if isinstance(item, Exception):
            raise item
        status, body = item
        return httpx.Response(status, json=body)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    try:
        result = vendor.describe_image(b"\xff\xd8\xff\xd9", _vendor_settings(), client=client, sleep=delays.append)
    except vendor.VendorError as error:
        result = error
    return result, calls, delays


def test_vendor_retries_openrouter_busy_body_then_succeeds() -> None:
    busy = {"error": {"code": 502, "message": "Upstream error from Nvidia: ResourceExhausted"}}
    result, calls, delays = _run_vendor([(200, busy), (429, {"error": {"code": 429}}), (200, _ok_body())])
    assert result == ("Uma mesa.", 0.9)
    assert len(calls) == 3
    assert delays == [1.5, 3.0]


def test_vendor_gives_up_after_three_attempts() -> None:
    import httpx

    from server import vendor

    result, calls, _ = _run_vendor([httpx.ConnectError("x"), (503, {}), (200, {"choices": []})])
    assert isinstance(result, vendor.VendorError)
    assert len(calls) == 3


def test_vendor_does_not_retry_definitive_errors() -> None:
    from server import vendor

    for status in (400, 401, 402, 403, 404):
        result, calls, delays = _run_vendor([(status, {"error": {"code": status}})])
        assert isinstance(result, vendor.VendorError)
        assert len(calls) == 1
        assert delays == []


def test_vendor_retries_truncated_reply() -> None:
    cut = {"choices": [{"finish_reason": "length", "message": {"content": '{"description": "Uma'}}]}
    result, calls, _ = _run_vendor([(200, cut), (200, _ok_body())])
    assert result == ("Uma mesa.", 0.9)
    assert len(calls) == 2


def test_vendor_asks_for_brazilian_portuguese() -> None:
    _, calls, _ = _run_vendor([(200, _ok_body())])
    assert "português do Brasil" in calls[0]


@pytest.mark.parametrize(
    ("detail", "expected"),
    [("short", "no máximo três frases"), ("medium", "no máximo seis frases"), ("long", "no máximo nove frases")],
)
def test_prompt_length_by_detail(detail: str, expected: str) -> None:
    from server.prompt import build_prompt

    assert expected in build_prompt(detail)


def test_prompt_full_asks_for_maximum_detail() -> None:
    from server.prompt import build_prompt

    prompt = build_prompt("full")
    assert "máximo de detalhes possível" in prompt
    assert "no máximo" not in prompt.split("Regras")[0].replace("máximo de detalhes", "")


def test_prompt_defaults_to_medium() -> None:
    from server.prompt import FIXED_PROMPT, build_prompt

    assert FIXED_PROMPT == build_prompt("medium", False)
    assert build_prompt("bogus") == FIXED_PROMPT


def test_prompt_people_never_identifies() -> None:
    from server.prompt import build_prompt

    without_people = build_prompt(people=False)
    with_people = build_prompt(people=True)
    assert "roupas" not in without_people
    assert "roupas, postura" in with_people
    for prompt in (without_people, with_people):
        assert "NUNCA identifique" in prompt
        assert "idade, gênero" in prompt
        assert "Não leia documentos" in prompt


def test_describe_passes_detail_and_people_to_vendor(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    from server.prompt import build_prompt

    captured: dict[str, str] = {}

    def fake(data: bytes, settings: object, prompt: str = "") -> tuple[str, float]:
        captured["prompt"] = prompt
        return ("Uma mesa.", 0.9)

    monkeypatch.setattr(main_module.vendor, "describe_image", fake)
    jpeg = ("p.jpg", make_jpeg_with_exif(), "image/jpeg")
    client.post("/api/describe", files={"image": jpeg}, data={"detail": "long", "people": "1"})
    assert captured["prompt"] == build_prompt("long", True)
    client.post("/api/describe", files={"image": jpeg})
    assert captured["prompt"] == build_prompt("medium", False)
    client.post("/api/describe", files={"image": jpeg}, data={"detail": "../hack"})
    assert captured["prompt"] == build_prompt("medium", False)



FISH_ID = "a53e5ba5098445f4b017149697701dc8"


def _tts_settings(tmp_path, model: str = "fish-audio/s2.1-pro-free:free"):
    from server.config import get_settings

    return dataclasses.replace(
        get_settings(),
        piper_voices_dir=tmp_path / "piper",
        tts_model=model,
        tts_voices=((FISH_ID, "OnyxGrave"), ("0ba1afd27db44eb2b4cb27fd331b93aa", "Narrador01")),
        tts_api_base="https://tts.test/v1",
        tts_api_key="test-key",
        audio_cache_dir=tmp_path / "audios",
    )


def _tts_client(responses: list):
    import httpx

    requests: list[dict] = []
    queue = list(responses)

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append({"url": str(request.url), "body": json.loads(request.content)})
        status, body = queue.pop(0)
        if isinstance(body, bytes):
            return httpx.Response(status, content=body, headers={"content-type": "audio/mpeg"})
        return httpx.Response(status, json=body)

    return httpx.Client(transport=httpx.MockTransport(handler)), requests


def test_parse_tts_model_ids() -> None:
    from server.config import _parse_tts_voices

    parsed = _parse_tts_voices(f"{FISH_ID}:OnyxGrave, sem-nome, x:../etc ,abc:Nanna,")
    assert parsed == ((FISH_ID, "OnyxGrave"), ("abc", "Nanna"))


def test_cloud_voices_listed_only_with_model(tmp_path) -> None:
    from server import tts

    assert [v.label for v in tts.list_voices(_tts_settings(tmp_path))] == ["OnyxGrave", "Narrador01"]
    assert tts.list_voices(_tts_settings(tmp_path))[0].id == f"cloud:{FISH_ID}"
    assert tts.list_voices(_tts_settings(tmp_path, model="")) == []


def test_cloud_tts_sends_openrouter_request(tmp_path) -> None:
    from server import tts

    client, requests = _tts_client([(200, b"ID3-fake-mp3")])
    speech = tts.synthesize("Oi.", f"cloud:{FISH_ID}", _tts_settings(tmp_path), client=client)
    assert speech == tts.Speech(b"ID3-fake-mp3", "audio/mpeg")
    assert requests[0]["url"] == "https://tts.test/v1/audio/speech"
    assert requests[0]["body"] == {
        "model": "fish-audio/s2.1-pro-free:free",
        "input": "Oi.",
        "voice": FISH_ID,
        "response_format": "mp3",
    }


def test_cloud_tts_rejected_voice_gives_clear_error(tmp_path) -> None:
    from server import tts

    client, requests = _tts_client([(400, {"error": {"code": 400, "message": "Provider returned 400"}})])
    with pytest.raises(tts.TtsError) as caught:
        tts.synthesize("Oi.", f"cloud:{FISH_ID}", _tts_settings(tmp_path), client=client, sleep=lambda _: None)
    assert len(requests) == 1
    assert "OnyxGrave" in caught.value.user_message
    assert "modelo de voz configurado" in caught.value.user_message
    assert "TTS_MODEL_IDS" in str(caught.value)


def test_cloud_tts_retries_busy_service(tmp_path) -> None:
    from server import tts

    delays: list[float] = []
    client, requests = _tts_client([(429, {"error": {"code": 429}}), (502, {}), (200, b"ID3")])
    speech = tts.synthesize("Oi.", f"cloud:{FISH_ID}", _tts_settings(tmp_path), client=client, sleep=delays.append)
    assert speech.audio == b"ID3"
    assert len(requests) == 3
    assert delays == [1.5, 3.0]


def test_fixed_phrases_are_cached_per_voice_folder(tmp_path) -> None:
    from server import tts

    settings = _tts_settings(tmp_path)
    client, requests = _tts_client([(200, b"ID3-first")])
    first = tts.synthesize("Descrição pronta.", f"cloud:{FISH_ID}", settings, cache=True, client=client)
    second = tts.synthesize("Descrição pronta.", f"cloud:{FISH_ID}", settings, cache=True, client=client)
    assert first == second == tts.Speech(b"ID3-first", "audio/mpeg")
    assert len(requests) == 1
    files = list((tmp_path / "audios" / "OnyxGrave").glob("*.mp3"))
    assert len(files) == 1


def test_descriptions_are_not_cached(tmp_path) -> None:
    from server import tts

    settings = _tts_settings(tmp_path)
    client, requests = _tts_client([(200, b"ID3-a"), (200, b"ID3-b")])
    tts.synthesize("Uma mesa.", f"cloud:{FISH_ID}", settings, client=client)
    tts.synthesize("Uma mesa.", f"cloud:{FISH_ID}", settings, client=client)
    assert len(requests) == 2
    assert not (tmp_path / "audios").exists()


def test_speak_reports_voice_error_message(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(main_module.speak_limiter, "limit", 1000)

    def rejected(text: str, voice_id: str, settings: object, cache: bool = False):
        raise main_module.tts.TtsError("400", user_message="A voz Nanna não funciona com o modelo de voz configurado.")

    monkeypatch.setattr(main_module.tts, "synthesize", rejected)
    response = client.post("/api/speak", json={"text": "Oi.", "voice": "cloud:x"})
    assert response.status_code == 503
    assert response.json()["user_message"] == "A voz Nanna não funciona com o modelo de voz configurado."


def test_config_exposes_only_public_defaults(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DEFAULT_DETAIL", "long")
    monkeypatch.setenv("DEFAULT_PEOPLE", "true")
    monkeypatch.setenv("VISION_TIMEOUT_CONNECTION", "7")
    monkeypatch.setenv("VISION_TIMEOUT_REQUEST", "999")
    body = client.get("/api/config").json()
    assert body["defaults"]["detail"] == "long"
    assert body["defaults"]["people"] is True
    assert body["defaults"]["visionTimeoutConnection"] == 7
    assert body["defaults"]["visionTimeoutRequest"] == 300
    text = json.dumps(body).lower()
    for secret in ("key", "api_base", "openrouter", "model"):
        assert secret not in text


def test_vision_timeouts_default_to_ten_and_sixty(monkeypatch: pytest.MonkeyPatch) -> None:
    from server.config import get_settings

    monkeypatch.delenv("VISION_TIMEOUT_CONNECTION", raising=False)
    monkeypatch.delenv("VISION_TIMEOUT_REQUEST", raising=False)
    monkeypatch.setenv("VISION_TIMEOUT_S", "15")
    settings = get_settings()
    assert settings.vision_timeout_connection_s == 10
    assert settings.vision_timeout_request_s == 60


def test_vision_timeout_splits_connection_and_response() -> None:
    from server.vendor import vision_timeout

    settings = dataclasses.replace(_vendor_settings(), vision_timeout_connection_s=10, vision_timeout_request_s=60)
    timeout = vision_timeout(settings)
    assert (timeout.connect, timeout.write, timeout.pool, timeout.read) == (10, 10, 10, 60)


def test_describe_applies_clamped_user_overrides(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    def fake(data: bytes, settings, prompt: str = "") -> tuple[str, float]:
        captured["settings"] = settings
        return ("Uma mesa.", 0.4)

    monkeypatch.setattr(main_module.vendor, "describe_image", fake)
    jpeg = ("p.jpg", make_jpeg_with_exif(), "image/jpeg")
    form = {"timeout_connection": "0", "timeout_request": "5000", "confidence_threshold": "0.5"}
    body = client.post("/api/describe", files={"image": jpeg}, data=form).json()
    settings = captured["settings"]
    assert settings.vision_timeout_connection_s == 1
    assert settings.vision_timeout_request_s == 300
    assert settings.confidence_threshold == 0.5
    assert body["retry"] is True



def test_vision_attempts_follow_setting_and_backoff() -> None:
    import httpx

    from server import vendor

    calls: list[int] = []
    delays: list[float] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(200, json={"error": {"code": 502, "message": "Upstream error from Nvidia"}})

    settings = dataclasses.replace(_vendor_settings(), vision_attempts=6)
    client = httpx.Client(transport=httpx.MockTransport(handler))
    with pytest.raises(vendor.VendorError):
        vendor.describe_image(b"\xff\xd8\xff\xd9", settings, client=client, sleep=delays.append)
    assert len(calls) == 6
    assert delays == [1.5, 3.0, 6.0, 10.0, 10.0]


def test_vision_attempts_are_clamped(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    from server import user_settings

    captured: dict[str, object] = {}

    def fake(data: bytes, settings, prompt: str = "") -> tuple[str, float]:
        captured["attempts"] = settings.vision_attempts
        return ("Uma mesa.", 0.9)

    monkeypatch.setattr(main_module.vendor, "describe_image", fake)
    jpeg = ("p.jpg", make_jpeg_with_exif(), "image/jpeg")
    client.post("/api/describe", files={"image": jpeg}, data={"attempts": "99"})
    assert captured["attempts"] == 30
    client.post("/api/describe", files={"image": jpeg}, data={"attempts": "0"})
    assert captured["attempts"] == 1
    monkeypatch.setenv("VISION_ATTEMPTS", "100")
    assert client.get("/api/config").json()["defaults"]["visionAttempts"] == 30
    assert user_settings.clamp_attempts(None, 100) == 30
