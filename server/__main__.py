from __future__ import annotations

import argparse
import os

from .config import load_env_file


def _set_if(value: str | None, key: str) -> None:
    if value is not None:
        os.environ[key] = value


def main() -> None:
    load_env_file()
    parser = argparse.ArgumentParser(description="Olhos Falantes - backend proxy")
    parser.add_argument("--host", default=os.environ.get("API_HOST", "0.0.0.0"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("API_PORT", "8000")))
    parser.add_argument("--vision-api-key")
    parser.add_argument("--vision-api-base")
    parser.add_argument("--vision-model")
    parser.add_argument("--confidence-threshold", type=float)
    parser.add_argument("--reload", action="store_true")
    args = parser.parse_args()
    _set_if(args.vision_api_key, "VISION_API_KEY")
    _set_if(args.vision_api_base, "VISION_API_BASE")
    _set_if(args.vision_model, "VISION_MODEL")
    if args.confidence_threshold is not None:
        os.environ["CONFIDENCE_THRESHOLD"] = str(args.confidence_threshold)

    import uvicorn

    uvicorn.run("server.main:app", host=args.host, port=args.port, reload=args.reload)


if __name__ == "__main__":
    main()
