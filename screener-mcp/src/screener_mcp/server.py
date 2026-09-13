"""MCP server exposing screener.in to Claude.

Tools are read-only: they fetch public company pages, parse them into
structured data, and extract text from linked filings.
"""

from __future__ import annotations

from typing import Any, Literal

from mcp.server.mcpserver import MCPServer
from mcp.types import ToolAnnotations

from . import parsers
from .client import ScreenerClient, ScreenerError
from .config import Settings
from .documents import read_document as _read_document

INSTRUCTIONS = """
Access to screener.in, a database of listed Indian companies (NSE/BSE).

Typical flow: `search_companies` to resolve a name to its symbol, then
`get_company_overview` for the headline picture, `get_financial_statement` for
the numbers, and `list_company_documents` + `read_document` to read the
underlying annual reports and concall transcripts.

Symbols are screener's own (usually the NSE ticker: RELIANCE, TCS, HDFCBANK;
unlisted and BSE-only names use a numeric code). All money figures are in
crore rupees unless the label says otherwise, matching how screener displays
them. Prefer consolidated statements for groups with subsidiaries, which is
the default.
"""

mcp = MCPServer(
    name="screener",
    version="0.1.0",
    instructions=INSTRUCTIONS.strip(),
)

READ_ONLY = ToolAnnotations(readOnlyHint=True, openWorldHint=True)

_client: ScreenerClient | None = None


def get_client() -> ScreenerClient:
    global _client
    if _client is None:
        _client = ScreenerClient(Settings.from_env())
    return _client


def _company_path(symbol: str, consolidated: bool) -> str:
    symbol = symbol.strip().upper().strip("/")
    if not symbol:
        raise ScreenerError("A company symbol is required, e.g. 'RELIANCE'.")
    suffix = "consolidated/" if consolidated else ""
    return f"/company/{symbol}/{suffix}"


async def _company_html(symbol: str, consolidated: bool) -> str:
    client = get_client()
    try:
        return await client.fetch_text(_company_path(symbol, consolidated))
    except ScreenerError as exc:
        if consolidated and "Not found" in str(exc):
            # Companies with no subsidiaries have no consolidated page at all.
            return await client.fetch_text(_company_path(symbol, False))
        raise


@mcp.tool(annotations=READ_ONLY)
async def search_companies(query: str, limit: int = 10) -> dict[str, Any]:
    """Find companies on screener.in by name or ticker.

    Use this first when you only have a company's name -- it returns the
    symbol that every other tool in this server expects.

    Args:
        query: Company name or ticker fragment, e.g. "reliance" or "HDFC".
        limit: Maximum matches to return.
    """
    client = get_client()
    raw = await client.fetch_json(
        "/api/company/search/", params={"q": query, "v": 3, "fts": 1}
    )
    items = raw.get("results", raw) if isinstance(raw, dict) else raw
    if not isinstance(items, list):
        return {"query": query, "results": []}

    results = []
    for item in items[: max(1, limit)]:
        if not isinstance(item, dict):
            continue
        url = item.get("url") or ""
        symbol = url.strip("/").split("/")[1] if url.startswith("/company/") else None
        results.append(
            {
                "name": item.get("name"),
                "symbol": symbol,
                "company_id": item.get("id"),
                "url": client.url_for(url) if url else None,
            }
        )
    return {"query": query, "results": results}


@mcp.tool(annotations=READ_ONLY)
async def get_company_overview(
    symbol: str, consolidated: bool = True
) -> dict[str, Any]:
    """Get a company's headline numbers, business description and pros/cons.

    Returns market cap, current price, P/E, book value, dividend yield, ROCE
    and ROE as screener shows them, plus screener's own bullet-point pros and
    cons and links to its BSE/NSE pages.

    Args:
        symbol: screener symbol, e.g. "RELIANCE".
        consolidated: Use consolidated figures (default) rather than standalone.
    """
    client = get_client()
    html = await _company_html(symbol, consolidated)
    overview = parsers.parse_company_overview(html, client.settings.base_url)
    overview.update(
        {
            "symbol": symbol.strip().upper(),
            "consolidated": consolidated,
            "source_url": client.url_for(_company_path(symbol, consolidated)),
        }
    )
    return overview


@mcp.tool(annotations=READ_ONLY)
async def get_financial_statement(
    symbol: str,
    statement: Literal[
        "quarterly_results", "profit_loss", "balance_sheet", "cash_flow", "ratios"
    ],
    consolidated: bool = True,
) -> dict[str, Any]:
    """Get a full financial statement as structured rows and periods.

    `quarterly_results` gives the last ~12 quarters; `profit_loss`,
    `balance_sheet` and `cash_flow` give ~10 annual columns; `ratios` gives
    screener's derived figures (ROCE, working-capital days, cash conversion
    cycle and so on).

    Figures are in crore rupees unless the row label says otherwise. Each row
    carries both parsed numbers (`values`) and screener's original strings
    (`raw`).

    Args:
        symbol: screener symbol, e.g. "TCS".
        statement: Which statement to return.
        consolidated: Use consolidated figures (default) rather than standalone.
    """
    client = get_client()
    html = await _company_html(symbol, consolidated)
    result = parsers.parse_statement(html, statement)
    result.update(
        {
            "symbol": symbol.strip().upper(),
            "consolidated": consolidated,
            "units": "INR crore unless the row label states otherwise",
            "source_url": client.url_for(_company_path(symbol, consolidated)),
        }
    )
    if not result.get("found"):
        result["note"] = (
            f"No {statement} table found on the page. Banks and finance "
            "companies use different section layouts, and some statements are "
            "only visible to logged-in users (set SCREENER_SESSION_ID)."
        )
    return result


@mcp.tool(annotations=READ_ONLY)
async def get_shareholding_pattern(
    symbol: str,
    period: Literal["quarterly", "yearly"] = "quarterly",
    consolidated: bool = True,
) -> dict[str, Any]:
    """Get the shareholding pattern over time.

    Rows are promoter, FII, DII, government, public holdings and the
    shareholder count. Useful for spotting promoter pledging or stake changes.

    Args:
        symbol: screener symbol, e.g. "ITC".
        period: Quarterly (default) or yearly columns.
        consolidated: Use the consolidated page (default).
    """
    client = get_client()
    html = await _company_html(symbol, consolidated)
    result = parsers.parse_shareholding(html, period)
    result.update(
        {
            "symbol": symbol.strip().upper(),
            "units": "percent of equity, except the shareholder count",
            "source_url": client.url_for(_company_path(symbol, consolidated)),
        }
    )
    return result


@mcp.tool(annotations=READ_ONLY)
async def get_peer_comparison(
    symbol: str, consolidated: bool = True
) -> dict[str, Any]:
    """Compare a company against its screener-assigned industry peers.

    Returns each peer with market cap, P/E, ROCE, sales growth and the other
    columns screener shows in its peer table.

    Args:
        symbol: screener symbol, e.g. "INFY".
        consolidated: Use the consolidated page (default).
    """
    client = get_client()
    html = await _company_html(symbol, consolidated)
    company_id = parsers.extract_company_id(html)

    # screener loads the peer table lazily, so prefer the API fragment and only
    # fall back to whatever placeholder markup is in the page itself.
    if company_id is not None:
        try:
            fragment = await client.fetch_text(f"/api/company/{company_id}/peers/")
            result = parsers.parse_peers(fragment, client.settings.base_url)
            if result.get("rows"):
                result.update({"symbol": symbol.strip().upper(), "company_id": company_id})
                return result
        except ScreenerError:
            pass

    section_html = str(parsers.soup_of(html).find(id="peers") or "")
    result = parsers.parse_peers(section_html, client.settings.base_url)
    result.update({"symbol": symbol.strip().upper(), "company_id": company_id})
    if not result.get("rows"):
        result["note"] = "Peer data could not be loaded; it may require a logged-in session."
    return result


@mcp.tool(annotations=READ_ONLY)
async def list_company_documents(
    symbol: str,
    kind: Literal[
        "all", "annual_reports", "concalls", "credit_ratings", "announcements"
    ] = "all",
    limit: int = 40,
    consolidated: bool = True,
) -> dict[str, Any]:
    """List a company's filings: annual reports, concalls, credit ratings.

    Returns titles and URLs only. Pass a URL from here to `read_document` to
    get the actual text.

    Concall entries carry several links at once (transcript, notes, PPT,
    recording) in their `links` list -- pick the transcript to read what was
    said.

    Args:
        symbol: screener symbol, e.g. "ASIANPAINT".
        kind: Restrict to one document type, or "all".
        limit: Maximum documents per category.
        consolidated: Use the consolidated page (default).
    """
    client = get_client()
    html = await _company_html(symbol, consolidated)
    documents = parsers.parse_documents(html, client.settings.base_url)

    if kind != "all":
        documents = {kind: documents.get(kind, [])}

    trimmed = {key: value[: max(1, limit)] for key, value in documents.items() if value}
    counts = {key: len(value) for key, value in trimmed.items()}

    result: dict[str, Any] = {
        "symbol": symbol.strip().upper(),
        "counts": counts,
        "documents": trimmed,
        "source_url": client.url_for(_company_path(symbol, consolidated)),
    }
    if not counts:
        result["note"] = (
            "No documents found. screener shows most filings only to "
            "logged-in users -- set SCREENER_SESSION_ID to your browser's "
            "`sessionid` cookie."
        )
    return result


@mcp.tool(annotations=READ_ONLY)
async def read_document(
    url: str,
    start_page: int = 1,
    max_pages: int = 30,
    max_chars: int = 50_000,
) -> dict[str, Any]:
    """Extract readable text from a filing PDF or web page.

    Built for the URLs `list_company_documents` returns (annual reports and
    concall transcripts hosted on BSE/NSE). Long PDFs are read a window at a
    time: when the result says `has_more_pages`, call again with `start_page`
    set past the pages you already read.

    Scanned PDFs return little or no text; the result flags that rather than
    pretending otherwise.

    Args:
        url: Document URL, usually from `list_company_documents`.
        start_page: First PDF page to read (1-based).
        max_pages: How many PDF pages to read in this call.
        max_chars: Hard cap on returned characters.
    """
    return await _read_document(
        get_client(),
        url,
        start_page=start_page,
        max_pages=max_pages,
        max_chars=max_chars,
    )


@mcp.tool(annotations=READ_ONLY)
async def get_price_history(
    symbol: str, days: int = 365, consolidated: bool = True
) -> dict[str, Any]:
    """Get daily price, moving averages and volume for a company.

    Args:
        symbol: screener symbol, e.g. "MARUTI".
        days: Lookback window in days (screener supports up to ~10000).
        consolidated: Use the consolidated page to resolve the company id.
    """
    client = get_client()
    html = await _company_html(symbol, consolidated)
    company_id = parsers.extract_company_id(html)
    if company_id is None:
        raise ScreenerError(
            f"Could not determine screener's internal company id for {symbol!r}."
        )

    payload = await client.fetch_json(
        f"/api/company/{company_id}/chart/",
        params={
            "q": "Price-DMA50-DMA200-Volume",
            "days": days,
            "consolidated": "true" if consolidated else "false",
        },
    )

    series: dict[str, list[dict[str, Any]]] = {}
    for dataset in payload.get("datasets", []) if isinstance(payload, dict) else []:
        label = dataset.get("label") or dataset.get("metric") or "series"
        points = []
        for entry in dataset.get("values", []):
            if isinstance(entry, (list, tuple)) and len(entry) >= 2:
                points.append(
                    {"date": entry[0], "value": parsers.parse_number(str(entry[1]))}
                )
        series[label] = points

    return {
        "symbol": symbol.strip().upper(),
        "company_id": company_id,
        "days": days,
        "series": series,
        "note": "Prices are in rupees per share; volume is share count.",
    }


@mcp.tool(annotations=READ_ONLY)
async def run_screen(query: str, page: int = 1, limit: int = 25) -> dict[str, Any]:
    """Run a screener.in query and return the matching companies.

    Uses screener's own query language: conditions joined by AND, one per line
    or separated by "AND". Examples:

        Market Capitalization > 5000 AND Price to Earning < 20
        Return on capital employed > 20 AND Debt to equity < 0.5
        Sales growth 5Years > 15 AND Profit growth 5Years > 15

    Field names must match screener's labels exactly. Results are capped per
    page by screener itself; use `page` to go further.

    Args:
        query: A screener query string.
        page: 1-based results page.
        limit: Maximum rows to return from the page.
    """
    client = get_client()
    html = await client.fetch_text(
        "/screen/raw/", params={"query": query, "page": page}
    )
    result = parsers.parse_screen_results(html, client.settings.base_url)
    result["results"] = result.get("results", [])[: max(1, limit)]
    result.update({"query": query, "page": page})
    if not result["results"]:
        result["note"] = (
            "No rows parsed. Either nothing matched, or a field name is not "
            "one screener recognises -- check the spelling against the site."
        )
    return result


@mcp.tool(annotations=READ_ONLY)
async def diagnose() -> dict[str, Any]:
    """Check that screener.in is reachable and the parsers still work.

    Run this first when other tools return empty results -- it distinguishes a
    network problem, a missing login, and screener having changed its markup.
    """
    client = get_client()
    report: dict[str, Any] = {
        "base_url": client.settings.base_url,
        "authenticated": client.authenticated,
        "cache_dir": str(client.settings.cache_dir),
        "min_request_interval_seconds": client.settings.min_request_interval,
        "checks": {},
    }

    probe = client.settings.diagnose_symbol
    report["probe_symbol"] = probe
    try:
        html = await client.fetch_text(_company_path(probe, True), ttl_seconds=0)
    except Exception as exc:
        report["checks"]["fetch"] = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
        report["verdict"] = "Cannot reach screener.in. Check network and proxy settings."
        return report

    report["checks"]["fetch"] = {"ok": True, "bytes": len(html)}

    overview = parsers.parse_company_overview(html, client.settings.base_url)
    documents = parsers.parse_documents(html, client.settings.base_url)
    checks = {
        "company_name": bool(overview.get("name")),
        "company_id": overview.get("company_id") is not None,
        "top_ratios": len(overview.get("ratios") or {}) > 0,
        "quarterly_results": parsers.parse_statement(html, "quarterly_results").get("found"),
        "profit_loss": parsers.parse_statement(html, "profit_loss").get("found"),
        "balance_sheet": parsers.parse_statement(html, "balance_sheet").get("found"),
        "cash_flow": parsers.parse_statement(html, "cash_flow").get("found"),
        "shareholding": parsers.parse_shareholding(html).get("found"),
        "documents": any(documents.values()),
    }
    report["checks"]["parsers"] = checks

    failed = [name for name, ok in checks.items() if not ok]
    if not failed:
        report["verdict"] = "All parsers working."
    elif failed == ["documents"] and not client.authenticated:
        report["verdict"] = (
            "Everything works except documents, which screener shows only to "
            "logged-in users. Set SCREENER_SESSION_ID to read filings."
        )
    else:
        report["verdict"] = (
            f"These parsers returned nothing: {', '.join(failed)}. "
            "screener.in has probably changed its markup -- the selectors live "
            "in src/screener_mcp/parsers.py."
        )
    return report


@mcp.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False))
async def clear_cache() -> dict[str, Any]:
    """Delete cached screener responses so the next call refetches live data.

    Use this when figures look stale, for example right after results are
    announced.
    """
    removed = get_client().cache.clear()
    return {"removed_files": removed, "cache_dir": str(get_client().settings.cache_dir)}


def main() -> None:
    mcp.run("stdio")


if __name__ == "__main__":
    main()
