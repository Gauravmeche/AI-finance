"""A tiny content-addressed disk cache.

screener.in is a small site run on a shoestring; caching aggressively is both
faster for us and kinder to them. Entries are plain files named by a hash of
the request key, with freshness tracked by file mtime.
"""

from __future__ import annotations

import hashlib
import time
from pathlib import Path


class DiskCache:
    def __init__(self, root: Path) -> None:
        self.root = root

    def _path(self, key: str) -> Path:
        digest = hashlib.sha256(key.encode("utf-8")).hexdigest()
        # Shard by the first two characters so no single directory gets huge.
        return self.root / digest[:2] / digest

    def get(self, key: str, ttl_seconds: int) -> bytes | None:
        if ttl_seconds <= 0:
            return None
        path = self._path(key)
        try:
            age = time.time() - path.stat().st_mtime
        except OSError:
            return None
        if age > ttl_seconds:
            return None
        try:
            return path.read_bytes()
        except OSError:
            return None

    def set(self, key: str, data: bytes) -> None:
        path = self._path(key)
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            # Write-then-rename so a crash never leaves a half-written entry.
            tmp = path.with_suffix(".tmp")
            tmp.write_bytes(data)
            tmp.replace(path)
        except OSError:
            # A cache failure must never break a request.
            pass

    def clear(self) -> int:
        removed = 0
        if not self.root.exists():
            return 0
        for path in self.root.rglob("*"):
            if path.is_file():
                try:
                    path.unlink()
                    removed += 1
                except OSError:
                    pass
        return removed
