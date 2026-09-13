"""Parser behaviour against a screener-shaped company page."""

from screener_mcp import parsers

BASE_URL = "https://www.screener.in"


def test_extracts_company_id_from_api_url(synthetic_html):
    assert parsers.extract_company_id(synthetic_html) == 2726


def test_extracts_company_id_without_api_url():
    html = '<div id="company-info" data-company-id="999"></div>'
    soup = parsers.soup_of(html)
    assert parsers.extract_company_id(html, soup) == 999


def test_overview_pulls_name_ratios_and_links(synthetic_html):
    overview = parsers.parse_company_overview(synthetic_html, BASE_URL)

    assert overview["name"] == "Acme Industries Ltd"
    assert overview["company_id"] == 2726
    assert "refining" in overview["about"]

    assert overview["ratios"]["Stock P/E"]["value"] == 24.8
    assert overview["ratios"]["ROCE"]["value"] == 9.31
    # The display string is kept so unusual cells stay inspectable.
    assert overview["ratios"]["High / Low"]["display"] == "₹ 1,609 / 1,115"

    assert overview["links"]["bse"].startswith("https://www.bseindia.com/")
    assert overview["links"]["nse"].startswith("https://www.nseindia.com/")
    assert overview["links"]["website"] == "https://www.acmeindustries.example/"

    assert len(overview["pros"]) == 2
    assert overview["cons"][0].startswith("The company has delivered")


def test_quarterly_results_rows_and_periods(synthetic_html):
    result = parsers.parse_statement(synthetic_html, "quarterly_results")

    assert result["found"] is True
    assert result["periods"] == ["Jun 2024", "Sep 2024", "Dec 2024"]

    rows = {row["label"]: row for row in result["rows"]}
    # The "+" expand marker must not survive into the label.
    assert "Sales" in rows
    assert rows["Sales"]["values"]["Jun 2024"] == 236217.0
    assert rows["Net Profit"]["values"]["Dec 2024"] == 18540.0
    assert rows["Operating Profit"]["is_total"] is True
    assert "is_total" not in rows["OPM %"]

    # Negatives in both notations.
    assert rows["Other Income"]["values"]["Jun 2024"] == -1046.0
    assert rows["Other Income"]["values"]["Sep 2024"] == -2315.0

    # Blank and dash cells are None, not zero -- this matters for averages.
    assert rows["Interest"]["values"]["Dec 2024"] is None
    assert rows["EPS in Rs"]["values"]["Dec 2024"] is None

    # Raw strings are preserved alongside parsed numbers.
    assert rows["OPM %"]["raw"]["Jun 2024"] == "15%"


def test_each_statement_section_is_found(synthetic_html):
    for statement in ("profit_loss", "balance_sheet", "cash_flow", "ratios"):
        result = parsers.parse_statement(synthetic_html, statement)
        assert result["found"] is True, statement
        assert result["rows"], statement


def test_unknown_statement_is_rejected(synthetic_html):
    import pytest

    with pytest.raises(ValueError):
        parsers.parse_statement(synthetic_html, "income_statement")


def test_missing_section_reports_not_found():
    result = parsers.parse_statement("<html><body></body></html>", "profit_loss")
    assert result["found"] is False
    assert result["rows"] == []


def test_shareholding_quarterly_and_yearly_differ(synthetic_html):
    quarterly = parsers.parse_shareholding(synthetic_html, "quarterly")
    yearly = parsers.parse_shareholding(synthetic_html, "yearly")

    assert quarterly["found"] is True
    assert quarterly["periods"] == ["Sep 2024", "Dec 2024"]

    rows = {row["label"]: row for row in quarterly["rows"]}
    assert rows["Promoters"]["values"]["Dec 2024"] == 50.16
    assert rows["No. of Shareholders"]["values"]["Dec 2024"] == 3571364.0

    assert yearly["periods"] == ["Mar 2024", "Mar 2025"]


def test_documents_are_bucketed_by_type(synthetic_html):
    documents = parsers.parse_documents(synthetic_html, BASE_URL)

    assert len(documents["annual_reports"]) == 2
    assert documents["annual_reports"][0]["url"].endswith("ar2025.pdf")

    assert len(documents["credit_ratings"]) == 1
    assert "CRISIL" in documents["credit_ratings"][0]["title"]


def test_concall_row_keeps_every_link(synthetic_html):
    concalls = parsers.parse_documents(synthetic_html, BASE_URL)["concalls"]

    assert len(concalls) == 2
    latest = concalls[0]
    labels = [link["text"] for link in latest["links"]]
    assert labels == ["Transcript", "PPT", "REC"]

    transcript = next(l for l in latest["links"] if l["text"] == "Transcript")
    assert transcript["url"].endswith("q3fy25.pdf")
    assert "Jan 2025" in latest["title"]


def test_documents_absent_returns_empty_buckets():
    documents = parsers.parse_documents("<html></html>", BASE_URL)
    assert documents["annual_reports"] == []
    assert documents["concalls"] == []


def test_relative_document_urls_are_absolutised():
    html = """
    <section id="documents">
      <div class="documents annual-reports">
        <h3>Annual Reports</h3>
        <ul><li><a href="/company/docs/1/">FY2025</a></li></ul>
      </div>
    </section>
    """
    documents = parsers.parse_documents(html, BASE_URL)
    assert documents["annual_reports"][0]["url"] == f"{BASE_URL}/company/docs/1/"


def test_peers_table_keeps_company_urls():
    html = """
    <table class="data-table">
      <thead><tr><th>Name</th><th>CMP</th><th>P/E</th></tr></thead>
      <tbody>
        <tr><td><a href="/company/BPCL/">BPCL</a></td><td>295</td><td>8.12</td></tr>
        <tr><td><a href="/company/IOC/">IOC</a></td><td>138</td><td>-</td></tr>
      </tbody>
    </table>
    """
    peers = parsers.parse_peers(html, BASE_URL)

    assert peers["found"] is True
    assert peers["rows"][0]["label"] == "BPCL"
    assert peers["rows"][0]["url"] == f"{BASE_URL}/company/BPCL/"
    assert peers["rows"][0]["values"]["P/E"] == 8.12
    assert peers["rows"][1]["values"]["P/E"] is None


def test_screen_results_parse_into_records():
    html = """
    <table class="data-table">
      <thead><tr><th>S.No.</th><th>Name</th><th>CMP Rs.</th><th>ROCE %</th></tr></thead>
      <tbody>
        <tr><td>1.</td><td><a href="/company/ACME/">Acme Industries</a></td><td>1,275</td><td>9.31</td></tr>
        <tr><td>2.</td><td><a href="/company/BETA/">Beta Ltd</a></td><td>640</td><td>22.40</td></tr>
      </tbody>
    </table>
    """
    screen = parsers.parse_screen_results(html, BASE_URL)

    assert screen["found"] is True
    assert len(screen["results"]) == 2

    first = screen["results"][0]
    assert first["name"] == "Acme Industries"
    assert first["url"] == f"{BASE_URL}/company/ACME/"
    assert first["metrics"]["ROCE %"] == 9.31
    # The index column is not a metric.
    assert "S.No." not in first["metrics"]


def test_screen_skips_repeated_header_rows():
    html = """
    <table class="data-table">
      <thead><tr><th>S.No.</th><th>Name</th><th>CMP Rs.</th></tr></thead>
      <tbody>
        <tr><td>1.</td><td><a href="/company/ACME/">Acme</a></td><td>1,275</td></tr>
        <tr><th>S.No.</th><th>Name</th><th>CMP Rs.</th></tr>
        <tr><td>2.</td><td><a href="/company/BETA/">Beta</a></td><td>640</td></tr>
      </tbody>
    </table>
    """
    screen = parsers.parse_screen_results(html, BASE_URL)
    assert [r["name"] for r in screen["results"]] == ["Acme", "Beta"]


def test_clean_text_strips_expand_markers():
    assert parsers.clean_text("Sales\xa0+") == "Sales"
    assert parsers.clean_text("  Net   Profit ") == "Net Profit"
