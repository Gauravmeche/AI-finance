"""Command-line health check: `python -m screener_mcp.doctor`.

Fetches a live company page and reports which parsers still find their data,
so a markup change on screener.in shows up as a named failure rather than as
mysteriously empty tool results.
"""

from __future__ import annotations

import asyncio
import json
import sys

from .server import diagnose, get_client


async def _run() -> int:
    try:
        report = await diagnose()
    finally:
        await get_client().aclose()

    print(json.dumps(report, indent=2))

    checks = report.get("checks", {}).get("parsers", {})
    if not report.get("checks", {}).get("fetch", {}).get("ok"):
        return 2
    return 0 if all(checks.values()) else 1


def main() -> None:
    sys.exit(asyncio.run(_run()))


if __name__ == "__main__":
    main()
