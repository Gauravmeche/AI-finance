"""Number parsing is where scraped financial data quietly goes wrong."""

import pytest

from screener_mcp.parsers import parse_number


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("1,234", 1234.0),
        ("2,36,217", 236217.0),          # Indian digit grouping
        ("1,234.56", 1234.56),
        ("15%", 15.0),
        ("0.39 %", 0.39),
        ("₹ 1,275", 1275.0),
        ("₹ 17,25,842 Cr.", 1725842.0),  # unit suffix is dropped
        ("-1,046", -1046.0),
        ("(2,315)", -2315.0),            # accounting-style negative
        ("10", 10.0),
        ("11.19", 11.19),
    ],
)
def test_parses_screener_cell_formats(raw, expected):
    assert parse_number(raw) == expected


@pytest.mark.parametrize("raw", ["", "-", "--", "NA", "N/A", None, "   ", "abc"])
def test_missing_values_become_none(raw):
    assert parse_number(raw) is None


def test_does_not_confuse_zero_with_missing():
    assert parse_number("0") == 0.0
    assert parse_number("0%") == 0.0
