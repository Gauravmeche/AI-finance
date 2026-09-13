"""Download filings and pull readable text out of them.

Annual reports and concall transcripts linked from screener are PDFs hosted on
BSE/NSE, so this module handles both PDF and HTML sources and always returns
text bounded in size -- an annual report can run to 400 pages, which no caller
wants dumped into a context window whole.
"""

from __future__ import annotations

import io
import re
from typing import Any
from urllib.parse import urlparse

import anyio

from .client import ScreenerClient, ScreenerError
from .parsers import clean_text, soup_of

_PDF_MAGIC = b"%PDF"


def _looks_like_pdf(data: bytes, url: str) -> bool:
    return data[:4] == _PDF_MAGIC or urlparse(url).path.lower().endswith(".pdf")


def _extract_pdf_text(
    data: bytes, start_page: int, max_pages: int
) -> tuple[str, int, int]:
    """Return (text, total_pages, pages_read). Runs off the event loop."""
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    total_pages = len(reader.pages)

    first = max(1, start_page)
    last = min(total_pages, first + max_pages - 1)

    chunks: list[str] = []
    pages_read = 0
    for page_number in range(first, last + 1):
        try:
            page_text = reader.pages[page_number - 1].extract_text() or ""
        except Exception as exc:  # a single broken page must not kill the read
            page_text = f"[page {page_number}: could not extract text ({exc})]"
        chunks.append(f"\n--- page {page_number} ---\n{page_text.strip()}")
        pages_read += 1

    return "\n".join(chunks).strip(), total_pages, pages_read


def _extract_html_text(data: bytes) -> str:
    soup = soup_of(data.decode("utf-8", errors="replace"))
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    text = soup.get_text("\n", strip=True)
    return re.sub(r"\n{3,}", "\n\n", text)


async def read_document(
    client: ScreenerClient,
    url: str,
    *,
    start_page: int = 1,
    max_pages: int = 30,
    max_chars: int = 50_000,
) -> dict[str, Any]:
    """Fetch a document and return extracted text plus paging metadata."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ScreenerError(
            f"Refusing to fetch {url!r}: only http and https URLs are supported."
        )

    data = await client.fetch(
        url, ttl_seconds=client.settings.document_cache_ttl_seconds
    )

    result: dict[str, Any] = {
        "url": url,
        "bytes": len(data),
        "source": parsed.netloc,
    }

    if _looks_like_pdf(data, url):
        text, total_pages, pages_read = await anyio.to_thread.run_sync(
            _extract_pdf_text, data, start_page, max_pages
        )
        result.update(
            {
                "content_type": "pdf",
                "total_pages": total_pages,
                "start_page": max(1, start_page),
                "pages_read": pages_read,
                "has_more_pages": max(1, start_page) + pages_read - 1 < total_pages,
            }
        )
        if not text.strip() or len(text.strip()) < 40 * pages_read / 10:
            result["warning"] = (
                "Very little text was extracted. This PDF is probably a scan; "
                "it would need OCR, which this server does not do."
            )
    else:
        text = await anyio.to_thread.run_sync(_extract_html_text, data)
        result.update({"content_type": "html"})

    result["truncated"] = len(text) > max_chars
    if result["truncated"]:
        text = text[:max_chars]
        result["truncated_at_chars"] = max_chars
    result["text"] = text
    result["chars"] = len(text)
    return result
