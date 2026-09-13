"""Runtime configuration, sourced from environment variables."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    """Everything tunable about how we talk to screener.in."""

    base_url: str = "https://www.screener.in"
    #: Value of the `sessionid` cookie from a logged-in browser session.
    #: Optional -- without it screener serves a reduced view of some pages.
    session_id: str | None = None
    user_agent: str = DEFAULT_USER_AGENT
    #: Minimum seconds between two outbound requests. Be a good citizen.
    min_request_interval: float = 1.5
    #: How long a cached page stays fresh.
    cache_ttl_seconds: int = 6 * 60 * 60
    #: Documents (PDFs) are immutable once published, so cache them far longer.
    document_cache_ttl_seconds: int = 30 * 24 * 60 * 60
    cache_dir: Path = Path.home() / ".cache" / "screener-mcp"
    max_retries: int = 3
    timeout_seconds: float = 30.0
    max_document_bytes: int = 25 * 1024 * 1024
    #: Company `diagnose` fetches to check parser health.
    diagnose_symbol: str = "RELIANCE"

    @classmethod
    def from_env(cls) -> "Settings":
        cache_dir = os.environ.get("SCREENER_CACHE_DIR")
        return cls(
            base_url=os.environ.get("SCREENER_BASE_URL", cls.base_url).rstrip("/"),
            session_id=os.environ.get("SCREENER_SESSION_ID") or None,
            user_agent=os.environ.get("SCREENER_USER_AGENT", DEFAULT_USER_AGENT),
            min_request_interval=_env_float("SCREENER_MIN_REQUEST_INTERVAL", 1.5),
            cache_ttl_seconds=_env_int("SCREENER_CACHE_TTL", 6 * 60 * 60),
            document_cache_ttl_seconds=_env_int(
                "SCREENER_DOCUMENT_CACHE_TTL", 30 * 24 * 60 * 60
            ),
            cache_dir=Path(cache_dir) if cache_dir else cls.cache_dir,
            max_retries=_env_int("SCREENER_MAX_RETRIES", 3),
            timeout_seconds=_env_float("SCREENER_TIMEOUT", 30.0),
            max_document_bytes=_env_int(
                "SCREENER_MAX_DOCUMENT_BYTES", 25 * 1024 * 1024
            ),
            diagnose_symbol=os.environ.get("SCREENER_DIAGNOSE_SYMBOL", "RELIANCE"),
        )
