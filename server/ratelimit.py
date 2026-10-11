from __future__ import annotations

import time
from collections import deque
from threading import Lock

from .config import get_settings


class RateLimiter:
    def __init__(self, limit: int, window_s: float) -> None:
        self.limit = limit
        self.window_s = window_s
        self._hits: dict[str, deque[float]] = {}
        self._lock = Lock()

    def allow(self, key: str, now: float | None = None) -> bool:
        moment = time.monotonic() if now is None else now
        with self._lock:
            bucket = self._hits.setdefault(key, deque())
            while bucket and moment - bucket[0] > self.window_s:
                bucket.popleft()
            if len(bucket) >= self.limit:
                return False
            bucket.append(moment)
            return True


_settings = get_settings()
limiter = RateLimiter(limit=_settings.rate_limit, window_s=_settings.rate_window_s)
speak_limiter = RateLimiter(limit=_settings.speak_rate_limit, window_s=_settings.rate_window_s)
