"""HTTP access to screener.in: rate limited, cached, retried."""

from __future__ import annotations

import asyncio
import json
import time
from typing import Any
from urllib.parse import urlencode, urljoin

import httpx

from .cache import DiskCache
from .config import Settings


class ScreenerError(RuntimeError):
    """Raised for errors we can explain to the caller in plain language."""


class RateLimiter:
    """Serialises outbound requests with a minimum gap between them."""

    def __init__(self, min_interval: float) -> None:
        self.min_interval = min_interval
        self._lock = asyncio.Lock()
        self._next_allowed = 0.0

    async def acquire(self) -> None:
        async with self._lock:
            now = time.monotonic()
            wait = self._next_allowed - now
            if wait > 0:
                await asyncio.sleep(wait)
                now = time.monotonic()
            self._next_allowed = now + self.min_interval


class ScreenerClient:
    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or Settings.from_env()
        self.cache = DiskCache(self.settings.cache_dir)
        self._limiter = RateLimiter(self.settings.min_request_interval)
        self._client: httpx.AsyncClient | None = None

    @property
    def authenticated(self) -> bool:
        return bool(self.settings.session_id)

    def _ensure_client(self) -> httpx.AsyncClient:
        if self._client is None:
            headers = {
                "User-Agent": self.settings.user_agent,
                "Accept-Language": "en-US,en;q=0.9",
                "Accept": (
                    "text/html,application/xhtml+xml,application/xml;q=0.9,"
                    "image/avif,image/webp,*/*;q=0.8"
                ),
            }
            cookies = {}
            if self.settings.session_id:
                cookies["sessionid"] = self.settings.session_id
            self._client = httpx.AsyncClient(
                headers=headers,
                cookies=cookies,
                timeout=self.settings.timeout_seconds,
                follow_redirects=True,
            )
        return self._client

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    def url_for(self, path: str, params: dict[str, Any] | None = None) -> str:
        url = path if path.startswith("http") else urljoin(self.settings.base_url + "/", path.lstrip("/"))
        if params:
            clean = {k: v for k, v in params.items() if v is not None}
            if clean:
                url = f"{url}{'&' if '?' in url else '?'}{urlencode(clean)}"
        return url

    async def fetch(
        self,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        ttl_seconds: int | None = None,
        headers: dict[str, str] | None = None,
        max_bytes: int | None = None,
    ) -> bytes:
        """Fetch a URL, returning raw bytes. Cached and rate limited."""
        url = self.url_for(path, params)
        ttl = self.settings.cache_ttl_seconds if ttl_seconds is None else ttl_seconds
        # The session cookie changes what the server returns, so it is part of
        # the cache key -- otherwise a logged-out response would be served to a
        # logged-in caller and vice versa.
        cache_key = f"{'auth' if self.authenticated else 'anon'}|{url}"

        cached = self.cache.get(cache_key, ttl)
        if cached is not None:
            return cached

        client = self._ensure_client()
        last_error: str | None = None

        for attempt in range(self.settings.max_retries):
            await self._limiter.acquire()
            try:
                response = await client.get(url, headers=headers)
            except httpx.HTTPError as exc:
                last_error = f"{type(exc).__name__}: {exc}"
                await asyncio.sleep(2**attempt)
                continue

            if response.status_code == 404:
                raise ScreenerError(f"Not found on screener.in: {url}")
            if response.status_code in (401, 403):
                raise ScreenerError(
                    f"screener.in refused the request ({response.status_code}) for {url}. "
                    "This usually means the page needs a logged-in session -- set "
                    "SCREENER_SESSION_ID to your browser's `sessionid` cookie."
                )
            if response.status_code == 429 or response.status_code >= 500:
                last_error = f"HTTP {response.status_code}"
                # Respect Retry-After when screener sends one.
                retry_after = response.headers.get("Retry-After")
                delay = float(retry_after) if (retry_after or "").isdigit() else 2**attempt
                await asyncio.sleep(delay)
                continue

            response.raise_for_status()
            limit = max_bytes or self.settings.max_document_bytes
            content = response.content
            if len(content) > limit:
                raise ScreenerError(
                    f"Response from {url} is {len(content)} bytes, over the "
                    f"{limit} byte limit. Raise SCREENER_MAX_DOCUMENT_BYTES to allow it."
                )
            self.cache.set(cache_key, content)
            return content

        raise ScreenerError(
            f"Gave up fetching {url} after {self.settings.max_retries} attempts "
            f"(last error: {last_error})."
        )

    async def fetch_text(self, path: str, **kwargs: Any) -> str:
        return (await self.fetch(path, **kwargs)).decode("utf-8", errors="replace")

    async def fetch_json(self, path: str, **kwargs: Any) -> Any:
        raw = await self.fetch_text(path, **kwargs)
        try:
            return json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ScreenerError(
                f"Expected JSON from {self.url_for(path, kwargs.get('params'))} "
                f"but got something else ({exc})."
            ) from exc
