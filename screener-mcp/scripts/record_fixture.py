#!/usr/bin/env python3
"""Save a live screener.in company page as a test fixture.

Run this on a machine that can reach screener.in:

    python scripts/record_fixture.py RELIANCE

The saved HTML makes the parser tests run against the real site instead of the
synthetic fixture that ships with the repo.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from screener_mcp.client import ScreenerClient  # noqa: E402

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "tests" / "fixtures"


async def _run(symbol: str, consolidated: bool) -> None:
    client = ScreenerClient()
    suffix = "consolidated/" if consolidated else ""
    try:
        html = await client.fetch_text(
            f"/company/{symbol.upper()}/{suffix}", ttl_seconds=0
        )
    finally:
        await client.aclose()

    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
    name = f"company_{symbol.lower()}{'_consolidated' if consolidated else ''}.html"
    target = FIXTURE_DIR / name
    target.write_text(html, encoding="utf-8")

    print(f"Wrote {target} ({len(html):,} bytes)")
    if not client.authenticated:
        print(
            "Note: recorded while logged out, so the Documents section is "
            "probably missing. Set SCREENER_SESSION_ID and re-record to "
            "capture filings."
        )


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    symbol = args[0] if args else "RELIANCE"
    consolidated = "--standalone" not in sys.argv
    asyncio.run(_run(symbol, consolidated))


if __name__ == "__main__":
    main()
