"""Turn screener.in HTML into structured data.

Every selector screener's markup depends on lives in this module, so when the
site changes there is exactly one file to fix. Parsers are deliberately
forgiving: they try a primary selector, fall back to structural heuristics, and
return partial data rather than raising when one field goes missing.
"""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urljoin

from bs4 import BeautifulSoup, Tag

#: Section ids on a screener company page, mapped to the names we expose.
STATEMENT_SECTIONS = {
    "quarterly_results": "quarters",
    "profit_loss": "profit-loss",
    "balance_sheet": "balance-sheet",
    "cash_flow": "cash-flow",
    "ratios": "ratios",
}

_COMPANY_ID_RE = re.compile(r"/api/company/(\d+)/")
_NUMBER_RE = re.compile(r"-?\d[\d,]*\.?\d*")


def soup_of(html: str) -> BeautifulSoup:
    try:
        return BeautifulSoup(html, "lxml")
    except Exception:  # pragma: no cover - only if lxml is missing
        return BeautifulSoup(html, "html.parser")


def clean_text(node: Any) -> str:
    """Collapse whitespace and strip screener's expand-row markers."""
    if node is None:
        return ""
    text = node if isinstance(node, str) else node.get_text(" ", strip=True)
    text = text.replace("\xa0", " ")
    text = re.sub(r"\s+", " ", text).strip()
    # Expandable rows render as "Sales +" / "Expenses -".
    text = re.sub(r"\s*[+−-]\s*$", "", text).strip()
    return text


def parse_number(raw: str | None) -> float | None:
    """Parse a screener cell into a float, or None when it is not a number.

    Handles thousands separators, percent signs, currency symbols, unit
    suffixes ("1,234 Cr"), and accounting-style negatives "(123)".
    """
    if raw is None:
        return None
    text = raw.replace("\xa0", " ").strip()
    if text in ("", "-", "--", "NA", "N/A", "nan"):
        return None

    negative = text.startswith("(") and text.endswith(")")
    match = _NUMBER_RE.search(text)
    if not match:
        return None
    try:
        value = float(match.group(0).replace(",", ""))
    except ValueError:
        return None
    if negative and value > 0:
        value = -value
    return value


def _first_number(text: str) -> float | None:
    return parse_number(text)


def parse_data_table(table: Tag) -> dict[str, Any]:
    """Parse a screener `table.data-table` into periods + labelled rows.

    Returns both parsed floats (`values`) and the original strings (`raw`), so
    callers can show exactly what the site showed when a cell is unusual.
    """
    header_cells: list[str] = []
    thead = table.find("thead")
    if thead is not None:
        header_row = thead.find("tr")
        if header_row is not None:
            header_cells = [clean_text(c) for c in header_row.find_all(["th", "td"])]

    # The first header cell labels the row-name column and is usually blank.
    periods = header_cells[1:] if header_cells else []

    rows: list[dict[str, Any]] = []
    body = table.find("tbody") or table
    for tr in body.find_all("tr"):
        cells = tr.find_all(["td", "th"])
        if len(cells) < 2:
            continue
        label = clean_text(cells[0])
        if not label:
            continue

        raw_values = [clean_text(c) for c in cells[1:]]
        values: dict[str, float | None] = {}
        raw: dict[str, str] = {}
        for index, cell in enumerate(raw_values):
            key = periods[index] if index < len(periods) else f"column_{index + 1}"
            values[key] = parse_number(cell)
            raw[key] = cell

        row: dict[str, Any] = {"label": label, "values": values, "raw": raw}
        classes = tr.get("class") or []
        if "strong" in classes:
            row["is_total"] = True
        rows.append(row)

    return {"periods": periods, "rows": rows}


def find_section_table(soup: BeautifulSoup, section_id: str) -> Tag | None:
    section = soup.find("section", id=section_id) or soup.find(id=section_id)
    if section is None:
        return None
    return section.find("table", class_="data-table") or section.find("table")


def extract_company_id(html: str, soup: BeautifulSoup | None = None) -> int | None:
    """Find screener's internal numeric company id.

    The id shows up in the `/api/company/<id>/...` URLs the page uses for its
    charts and lazy-loaded sections, which is far more stable than any single
    attribute, so we regex the raw HTML first and only then try attributes.
    """
    match = _COMPANY_ID_RE.search(html)
    if match:
        return int(match.group(1))

    if soup is not None:
        for attr in ("data-company-id", "data-company", "data-id"):
            node = soup.find(attrs={attr: True})
            if node is not None:
                raw = str(node.get(attr, "")).strip()
                if raw.isdigit():
                    return int(raw)
    return None


def parse_top_ratios(soup: BeautifulSoup) -> dict[str, Any]:
    """Parse the headline ratio strip (Market Cap, P/E, ROCE, ...)."""
    ratios: dict[str, Any] = {}
    container = soup.find(id="top-ratios") or soup.find("ul", class_="company-ratios")
    if container is None:
        return ratios

    for item in container.find_all("li"):
        name_node = item.find(class_="name")
        value_node = item.find(class_="value")
        if name_node is None or value_node is None:
            continue
        name = clean_text(name_node).rstrip(":")
        if not name:
            continue
        display = clean_text(value_node)
        ratios[name] = {"display": display, "value": parse_number(display)}
    return ratios


def parse_pros_cons(soup: BeautifulSoup) -> dict[str, list[str]]:
    result: dict[str, list[str]] = {"pros": [], "cons": []}
    for key in ("pros", "cons"):
        block = soup.find("div", class_=key)
        if block is None:
            continue
        result[key] = [clean_text(li) for li in block.find_all("li") if clean_text(li)]
    return result


def parse_company_links(soup: BeautifulSoup, base_url: str) -> dict[str, str]:
    """Pull the website / BSE / NSE links out of the company header."""
    links: dict[str, str] = {}
    container = soup.find("div", class_="company-links") or soup.find(id="company-links")
    candidates = container.find_all("a", href=True) if container else []
    if not candidates:
        candidates = soup.select("#top a[href]")

    for anchor in candidates:
        href = urljoin(base_url, anchor["href"])
        label = clean_text(anchor).lower()
        if "bseindia.com" in href or label.startswith("bse"):
            links.setdefault("bse", href)
        elif "nseindia.com" in href or label.startswith("nse"):
            links.setdefault("nse", href)
        elif href.startswith("http") and "screener.in" not in href:
            links.setdefault("website", href)
    return links


def parse_about(soup: BeautifulSoup) -> str:
    for selector in (
        ".company-profile .about p",
        ".company-profile p",
        "#company-info p",
        ".about p",
    ):
        node = soup.select_one(selector)
        if node is not None:
            text = clean_text(node)
            if text:
                return text
    return ""


def parse_company_overview(html: str, base_url: str) -> dict[str, Any]:
    soup = soup_of(html)
    heading = soup.find("h1")
    return {
        "name": clean_text(heading) if heading else "",
        "company_id": extract_company_id(html, soup),
        "about": parse_about(soup),
        "links": parse_company_links(soup, base_url),
        "ratios": parse_top_ratios(soup),
        **parse_pros_cons(soup),
    }


def parse_statement(html: str, statement: str) -> dict[str, Any]:
    if statement not in STATEMENT_SECTIONS:
        raise ValueError(
            f"Unknown statement {statement!r}. "
            f"Expected one of: {', '.join(sorted(STATEMENT_SECTIONS))}."
        )
    soup = soup_of(html)
    table = find_section_table(soup, STATEMENT_SECTIONS[statement])
    if table is None:
        return {"statement": statement, "periods": [], "rows": [], "found": False}
    parsed = parse_data_table(table)
    parsed.update({"statement": statement, "found": True})
    return parsed


def parse_shareholding(html: str, period: str = "quarterly") -> dict[str, Any]:
    soup = soup_of(html)
    target_id = "quarterly-shp" if period == "quarterly" else "yearly-shp"
    container = soup.find(id=target_id)
    table = None
    if container is not None:
        table = container.find("table", class_="data-table") or container.find("table")
    if table is None:
        table = find_section_table(soup, "shareholding")
    if table is None:
        return {"period": period, "periods": [], "rows": [], "found": False}
    parsed = parse_data_table(table)
    parsed.update({"period": period, "found": True})
    return parsed


_DOCUMENT_BUCKETS = (
    ("annual_reports", ("annual-report", "annual report")),
    ("credit_ratings", ("credit-rating", "credit rating")),
    ("concalls", ("concall", "conference call", "transcript")),
    ("announcements", ("announcement",)),
)


def _bucket_for(title: str, classes: list[str]) -> str:
    haystack = " ".join(classes).lower() + " " + title.lower()
    for bucket, needles in _DOCUMENT_BUCKETS:
        if any(needle in haystack for needle in needles):
            return bucket
    return "other"


def parse_documents(html: str, base_url: str) -> dict[str, list[dict[str, Any]]]:
    """Parse the Documents section: annual reports, concalls, credit ratings.

    Concall rows carry several links (Transcript / Notes / PPT / REC), so every
    entry keeps the full link list alongside a convenience `url`.
    """
    soup = soup_of(html)
    result: dict[str, list[dict[str, Any]]] = {
        "annual_reports": [],
        "credit_ratings": [],
        "concalls": [],
        "announcements": [],
        "other": [],
    }

    section = soup.find("section", id="documents") or soup.find(id="documents")
    if section is None:
        return result

    blocks = section.find_all("div", class_="documents")
    if not blocks:
        blocks = [section]

    for block in blocks:
        heading = block.find(["h2", "h3", "h4"])
        title = clean_text(heading) if heading else ""
        bucket = _bucket_for(title, block.get("class") or [])

        for item in block.find_all("li"):
            anchors = item.find_all("a", href=True)
            if not anchors:
                continue
            links = [
                {
                    "text": clean_text(a) or a["href"],
                    "url": urljoin(base_url, a["href"]),
                }
                for a in anchors
            ]
            label = clean_text(item)
            # Strip the trailing link labels so the title reads cleanly.
            for link in links:
                if label.endswith(link["text"]):
                    label = label[: -len(link["text"])].strip()
            result[bucket].append(
                {
                    "title": label or links[0]["text"],
                    "url": links[0]["url"],
                    "links": links,
                    "section": title,
                }
            )

    return result


def parse_peers(html: str, base_url: str) -> dict[str, Any]:
    """Parse the peer-comparison table (from the page or the API fragment)."""
    soup = soup_of(html)
    table = soup.find("table", class_="data-table") or soup.find("table")
    if table is None:
        return {"periods": [], "rows": [], "found": False}

    parsed = parse_data_table(table)
    # Re-attach each peer's screener URL, which parse_data_table drops.
    body = table.find("tbody") or table
    anchors = []
    for tr in body.find_all("tr"):
        cells = tr.find_all(["td", "th"])
        if len(cells) < 2 or not clean_text(cells[0]):
            continue
        anchor = tr.find("a", href=True)
        anchors.append(urljoin(base_url, anchor["href"]) if anchor else None)

    for row, url in zip(parsed["rows"], anchors):
        row["url"] = url

    parsed["found"] = True
    return parsed


def parse_screen_results(html: str, base_url: str) -> dict[str, Any]:
    """Parse the results table of a screener.in screen."""
    soup = soup_of(html)
    table = soup.find("table", class_="data-table") or soup.find("table")
    if table is None:
        return {"columns": [], "results": [], "found": False}

    header_cells: list[str] = []
    thead = table.find("thead")
    if thead is not None:
        header_row = thead.find("tr")
        if header_row is not None:
            header_cells = [clean_text(c) for c in header_row.find_all(["th", "td"])]

    results: list[dict[str, Any]] = []
    body = table.find("tbody") or table
    for tr in body.find_all("tr"):
        cells = tr.find_all(["td", "th"])
        if len(cells) < 2:
            continue
        texts = [clean_text(c) for c in cells]
        # screener repeats the header row inside tbody on long result pages.
        if header_cells and texts[: len(header_cells)] == header_cells:
            continue
        anchor = tr.find("a", href=True)
        if anchor is None:
            continue

        record: dict[str, Any] = {
            "name": clean_text(anchor),
            "url": urljoin(base_url, anchor["href"]),
            "metrics": {},
        }
        for index, text in enumerate(texts):
            column = header_cells[index] if index < len(header_cells) else f"column_{index}"
            if column.lower() in ("s.no.", "s.no", "name", ""):
                continue
            record["metrics"][column] = parse_number(text)
        results.append(record)

    return {"columns": header_cells, "results": results, "found": True}
