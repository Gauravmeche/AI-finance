# screener-mcp

An MCP server that gives Claude structured access to [screener.in](https://www.screener.in) —
financial statements, shareholding, peers, screens, and the text of annual
reports and concall transcripts.

screener.in has no public API, so this server reads the same pages a browser
sees and parses them. That shapes everything below: it caches hard, rate limits
itself, and tells you plainly when a parser stops matching the site.

## What Claude can do with it

| Tool | What it returns |
| --- | --- |
| `search_companies` | Resolve a company name to a screener symbol |
| `get_company_overview` | Market cap, P/E, ROCE, ROE, book value, pros/cons, description |
| `get_financial_statement` | Quarterly results, P&L, balance sheet, cash flow, ratios |
| `get_shareholding_pattern` | Promoter / FII / DII / public holdings over time |
| `get_peer_comparison` | Industry peers with their key metrics |
| `list_company_documents` | Annual reports, concalls, credit ratings — titles and URLs |
| `read_document` | Extracted text from a filing PDF, read in page windows |
| `get_price_history` | Daily price, 50/200 DMA and volume |
| `run_screen` | Run a screener.in query and get matching companies |
| `diagnose` | Check connectivity, login state and parser health |
| `clear_cache` | Drop cached responses so the next call refetches |

So you can ask Claude things like:

> Pull Asian Paints' last 8 quarters, then read the most recent concall
> transcript and tell me what management said about gross margin.

> Screen for companies with ROCE > 20 and debt to equity < 0.5, then compare
> the top five on 5-year sales growth.

## Install

```bash
cd screener-mcp
python3 -m venv .venv
./.venv/bin/pip install -e .
```

Requires Python 3.10+.

## Connect it to Claude

### Claude Code

```bash
claude mcp add screener -- /absolute/path/to/screener-mcp/.venv/bin/screener-mcp
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "screener": {
      "command": "/absolute/path/to/screener-mcp/.venv/bin/screener-mcp",
      "env": {
        "SCREENER_SESSION_ID": "your-sessionid-cookie"
      }
    }
  }
}
```

Then ask Claude to run `diagnose` as a first check.

## Logging in (optional, but read this)

screener.in shows a reduced page to logged-out visitors. **The Documents
section — annual reports, concall transcripts, credit ratings — is generally
not visible unless you are logged in.** If document tools come back empty, this
is almost always why.

To pass your session through:

1. Log in to screener.in in your browser.
2. Open DevTools → Application → Cookies → `https://www.screener.in`.
3. Copy the value of the `sessionid` cookie.
4. Set it as `SCREENER_SESSION_ID`.

The cookie is your login. Keep it out of version control, and expect to
refresh it when screener expires the session.

## Configuration

All optional, all via environment variables.

| Variable | Default | Purpose |
| --- | --- | --- |
| `SCREENER_SESSION_ID` | _unset_ | `sessionid` cookie for a logged-in session |
| `SCREENER_MIN_REQUEST_INTERVAL` | `1.5` | Minimum seconds between requests |
| `SCREENER_CACHE_TTL` | `21600` | Page cache lifetime in seconds (6h) |
| `SCREENER_DOCUMENT_CACHE_TTL` | `2592000` | Filing cache lifetime (30d) |
| `SCREENER_CACHE_DIR` | `~/.cache/screener-mcp` | Where cached responses live |
| `SCREENER_MAX_RETRIES` | `3` | Retries on 429/5xx |
| `SCREENER_TIMEOUT` | `30` | Per-request timeout in seconds |
| `SCREENER_MAX_DOCUMENT_BYTES` | `26214400` | Size ceiling for a single fetch (25 MB) |
| `SCREENER_USER_AGENT` | Chrome UA | Override the User-Agent |
| `SCREENER_DIAGNOSE_SYMBOL` | `RELIANCE` | Company `diagnose` probes for parser health |

## When screener changes its markup

It will, eventually. Every selector lives in `src/screener_mcp/parsers.py`, and
nothing else needs touching.

To see what broke:

```bash
./.venv/bin/python -m screener_mcp.doctor
```

That fetches a live company page and reports which parsers still find their
data. To fix a parser, record the current page as a fixture and work against
it offline:

```bash
./.venv/bin/python scripts/record_fixture.py RELIANCE
./.venv/bin/python -m pytest
```

## Tests

```bash
./.venv/bin/pip install -e ".[dev]"
./.venv/bin/python -m pytest
```

The committed fixture in `tests/fixtures/` is **synthetic** — hand-written to
mirror screener's documented structure, because the machine this was built on
could not reach screener.in. It pins parser behaviour (number formats, totals,
multi-link concall rows, malformed cells) but it is not proof that the
selectors match today's live site. Run `record_fixture.py` to replace it with
a real page, and the same tests then verify against reality.

## Fair use

This reads a site that has no public API and is run by a small team. The
defaults here — one request per 1.5s, 6-hour page cache, 30-day document
cache — exist to keep usage in the range of a person browsing rather than a
crawler. screener.in's terms restrict automated access and redistribution, so
treat this as a tool for your own research, keep the rate limit in place, and
don't republish what it pulls. If you need bulk or commercial data, screener
sells an export/API plan — use that instead.

## License

MIT
