import os
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE_URL = "https://huggingface.co/rhasspy/piper-voices/resolve/main"
VOICES = ["pt_BR-faber-medium", "pt_BR-cadu-medium", "pt_BR-jeff-medium"]


def voice_url(voice_id: str, suffix: str) -> str:
    lang, name, quality = voice_id.split("-")
    return f"{BASE_URL}/{lang.split('_')[0]}/{lang}/{name}/{quality}/{voice_id}{suffix}"


def download(url: str, target: Path) -> None:
    partial = target.with_name(target.name + ".part")
    with urllib.request.urlopen(url, timeout=60) as response, partial.open("wb") as out:
        while chunk := response.read(1 << 20):
            out.write(chunk)
    partial.replace(target)


def main() -> int:
    voices_dir = ROOT / os.environ.get("PIPER_VOICES_DIR", "models/piper")
    voices_dir.mkdir(parents=True, exist_ok=True)
    failed = False
    for voice_id in VOICES:
        for suffix in (".onnx.json", ".onnx"):
            target = voices_dir / f"{voice_id}{suffix}"
            if target.is_file():
                continue
            print(f"[vozes] baixando {target.name}...", flush=True)
            try:
                download(voice_url(voice_id, suffix), target)
            except OSError as error:
                print(f"[aviso] falha ao baixar {target.name}: {error}", file=sys.stderr)
                failed = True
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
