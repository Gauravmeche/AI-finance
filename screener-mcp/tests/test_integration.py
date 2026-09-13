"""End-to-end tests: MCP tools -> client -> parsers, against a local server.

These do not prove the selectors match today's screener.in (only a recorded
fixture can do that). They prove the plumbing -- routing, caching, retries,
error translation and tool output shape -- is correct.
"""

from __future__ import annotations

import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest

from tests.pdfbuild import build_pdf

FIXTURE = (Path(__file__).parent / "fixtures" / "company_synthetic.html").read_text()

PEERS_FRAGMENT = """
<table class="data-table">
  <thead><tr><th>Name</th><th>CMP</th><th>P/E</th></tr></thead>
  <tbody>
    <tr><td><a href="/company/BPCL/">BPCL</a></td><td>295</td><td>8.12</td></tr>
  </tbody>
</table>
"""

SCREEN_HTML = """
<table class="data-table">
  <thead><tr><th>S.No.</th><th>Name</th><th>CMP Rs.</th><th>ROCE %</th></tr></thead>
  <tbody>
    <tr><td>1.</td><td><a href="/company/ACME/">Acme Industries</a></td><td>1,275</td><td>9.31</td></tr>
  </tbody>
</table>
"""

request_log: list[str] = []
flaky_hits = {"count": 0}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):  # silence the default stderr spam
        pass

    def _send(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path
        request_log.append(path)
        query = parse_qs(parsed.query)

        if path in ("/company/ACME/consolidated/", "/company/ACME/"):
            return self._send(200, FIXTURE.encode(), "text/html")

        if path.startswith("/company/NOSUCH"):
            return self._send(404, b"not found", "text/html")

        if path.startswith("/company/PRIVATE"):
            return self._send(403, b"forbidden", "text/html")

        if path == "/api/company/search/":
            payload = [
                {"id": 2726, "name": "Acme Industries Ltd", "url": "/company/ACME/"},
                {"id": 99, "name": "Acme Beta Ltd", "url": "/company/ACMEB/"},
            ]
            return self._send(200, json.dumps(payload).encode(), "application/json")

        if path == "/api/company/2726/peers/":
            return self._send(200, PEERS_FRAGMENT.encode(), "text/html")

        if path == "/api/company/2726/chart/":
            payload = {
                "datasets": [
                    {"metric": "Price", "label": "Price",
                     "values": [["2025-01-01", "1250.5"], ["2025-01-02", "1275.0"]]},
                    {"metric": "Volume", "label": "Volume",
                     "values": [["2025-01-01", "10,50,000"]]},
                ]
            }
            return self._send(200, json.dumps(payload).encode(), "application/json")

        if path == "/screen/raw/":
            assert "query" in query
            return self._send(200, SCREEN_HTML.encode(), "text/html")

        if path == "/docs/transcript.pdf":
            return self._send(200, build_pdf(pages=3), "application/pdf")

        if path == "/docs/note.html":
            body = b"<html><body><script>x=1</script><h1>Rating</h1><p>Upgraded.</p></body></html>"
            return self._send(200, body, "text/html")

        if path == "/flaky":
            flaky_hits["count"] += 1
            if flaky_hits["count"] < 3:
                return self._send(500, b"server error", "text/plain")
            return self._send(200, b"recovered", "text/plain")

        return self._send(404, b"nope", "text/plain")


@pytest.fixture(scope="module")
def base_url():
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_port}"
    server.shutdown()


@pytest.fixture(autouse=True)
def client_env(base_url, tmp_path, monkeypatch):
    """Point the server module at the local stub with a fresh cache each test."""
    monkeypatch.setenv("SCREENER_BASE_URL", base_url)
    monkeypatch.setenv("SCREENER_CACHE_DIR", str(tmp_path / "cache"))
    monkeypatch.setenv("SCREENER_MIN_REQUEST_INTERVAL", "0")
    monkeypatch.setenv("SCREENER_MAX_RETRIES", "4")
    monkeypatch.setenv("NO_PROXY", "127.0.0.1,localhost")
    monkeypatch.setenv("SCREENER_DIAGNOSE_SYMBOL", "ACME")
    monkeypatch.delenv("SCREENER_SESSION_ID", raising=False)

    import screener_mcp.server as server_module

    server_module._client = None
    request_log.clear()
    flaky_hits["count"] = 0
    yield
    server_module._client = None


async def test_search_companies_maps_urls_to_symbols():
    from screener_mcp.server import search_companies

    result = await search_companies("acme")
    assert result["results"][0]["symbol"] == "ACME"
    assert result["results"][0]["company_id"] == 2726
    assert len(result["results"]) == 2


async def test_search_respects_limit():
    from screener_mcp.server import search_companies

    assert len((await search_companies("acme", limit=1))["results"]) == 1


async def test_company_overview_end_to_end():
    from screener_mcp.server import get_company_overview

    overview = await get_company_overview("acme")
    assert overview["name"] == "Acme Industries Ltd"
    assert overview["symbol"] == "ACME"
    assert overview["consolidated"] is True
    assert overview["ratios"]["ROE"]["value"] == 8.54


async def test_financial_statement_end_to_end():
    from screener_mcp.server import get_financial_statement

    result = await get_financial_statement("ACME", "quarterly_results")
    assert result["found"] is True
    assert "INR crore" in result["units"]
    labels = [row["label"] for row in result["rows"]]
    assert "Net Profit" in labels


async def test_consolidated_falls_back_to_standalone_when_absent(monkeypatch):
    """Companies with no subsidiaries have no /consolidated/ page at all."""
    from screener_mcp.server import get_company_overview

    seen: list[str] = []
    import screener_mcp.server as server_module
    original = server_module.get_client().fetch_text

    async def spy(path, **kwargs):
        seen.append(path)
        if path.endswith("/consolidated/"):
            from screener_mcp.client import ScreenerError

            raise ScreenerError("Not found on screener.in: " + path)
        return FIXTURE

    monkeypatch.setattr(server_module.get_client(), "fetch_text", spy)
    overview = await get_company_overview("ACME", consolidated=True)

    assert seen == ["/company/ACME/consolidated/", "/company/ACME/"]
    assert overview["name"] == "Acme Industries Ltd"


async def test_missing_company_raises_readable_error():
    from screener_mcp.client import ScreenerError
    from screener_mcp.server import get_company_overview

    with pytest.raises(ScreenerError, match="Not found"):
        await get_company_overview("NOSUCH", consolidated=False)


async def test_forbidden_response_mentions_session_cookie():
    from screener_mcp.client import ScreenerError
    from screener_mcp.server import get_company_overview

    with pytest.raises(ScreenerError, match="SCREENER_SESSION_ID"):
        await get_company_overview("PRIVATE", consolidated=False)


async def test_documents_listed_and_filtered():
    from screener_mcp.server import list_company_documents

    everything = await list_company_documents("ACME")
    assert everything["counts"]["annual_reports"] == 2
    assert everything["counts"]["concalls"] == 2

    only_concalls = await list_company_documents("ACME", kind="concalls")
    assert set(only_concalls["documents"]) == {"concalls"}


async def test_peer_comparison_uses_api_fragment():
    from screener_mcp.server import get_peer_comparison

    peers = await get_peer_comparison("ACME")
    assert peers["company_id"] == 2726
    assert peers["rows"][0]["label"] == "BPCL"
    assert "/api/company/2726/peers/" in request_log


async def test_price_history_normalises_series(base_url):
    from screener_mcp.server import get_price_history

    history = await get_price_history("ACME", days=30)
    assert history["series"]["Price"][1] == {"date": "2025-01-02", "value": 1275.0}
    assert history["series"]["Volume"][0]["value"] == 1050000.0


async def test_run_screen_returns_records():
    from screener_mcp.server import run_screen

    screen = await run_screen("Return on capital employed > 20")
    assert screen["results"][0]["name"] == "Acme Industries"
    assert screen["results"][0]["metrics"]["ROCE %"] == 9.31


async def test_read_document_extracts_pdf_pages(base_url):
    from screener_mcp.server import read_document

    result = await read_document(f"{base_url}/docs/transcript.pdf", max_pages=2)
    assert result["content_type"] == "pdf"
    assert result["total_pages"] == 3
    assert result["pages_read"] == 2
    assert result["has_more_pages"] is True
    assert "page 1" in result["text"]
    assert "page 3" not in result["text"]


async def test_read_document_paging_window(base_url):
    from screener_mcp.server import read_document

    result = await read_document(
        f"{base_url}/docs/transcript.pdf", start_page=3, max_pages=5
    )
    assert result["pages_read"] == 1
    assert result["has_more_pages"] is False
    assert "page 3" in result["text"]


async def test_read_document_truncates_to_max_chars(base_url):
    from screener_mcp.server import read_document

    result = await read_document(f"{base_url}/docs/transcript.pdf", max_chars=50)
    assert result["truncated"] is True
    assert len(result["text"]) == 50


async def test_read_document_handles_html(base_url):
    from screener_mcp.server import read_document

    result = await read_document(f"{base_url}/docs/note.html")
    assert result["content_type"] == "html"
    assert "Upgraded." in result["text"]
    assert "x=1" not in result["text"]  # scripts stripped


async def test_read_document_rejects_non_http_urls():
    from screener_mcp.client import ScreenerError
    from screener_mcp.server import read_document

    with pytest.raises(ScreenerError, match="only http and https"):
        await read_document("file:///etc/passwd")


async def test_responses_are_cached():
    from screener_mcp.server import get_company_overview

    await get_company_overview("ACME")
    first = request_log.count("/company/ACME/consolidated/")
    await get_company_overview("ACME")
    assert request_log.count("/company/ACME/consolidated/") == first


async def test_clear_cache_forces_refetch():
    from screener_mcp.server import clear_cache, get_company_overview

    await get_company_overview("ACME")
    before = request_log.count("/company/ACME/consolidated/")
    await clear_cache()
    await get_company_overview("ACME")
    assert request_log.count("/company/ACME/consolidated/") == before + 1


async def test_server_errors_are_retried(base_url):
    from screener_mcp.server import get_client

    body = await get_client().fetch(f"{base_url}/flaky", ttl_seconds=0)
    assert body == b"recovered"
    assert flaky_hits["count"] == 3


async def test_diagnose_reports_parser_health():
    from screener_mcp.server import diagnose

    report = await diagnose()
    assert report["checks"]["fetch"]["ok"] is True
    parsers_ok = report["checks"]["parsers"]
    assert parsers_ok["company_name"] is True
    assert parsers_ok["quarterly_results"] is True
    assert parsers_ok["documents"] is True
    assert report["verdict"] == "All parsers working."
