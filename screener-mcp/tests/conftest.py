from pathlib import Path

import pytest

FIXTURES = Path(__file__).parent / "fixtures"
BASE_URL = "https://www.screener.in"


def _load(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


@pytest.fixture(scope="session")
def company_html() -> str:
    """A recorded live page when one exists, else the synthetic fixture.

    Run `scripts/record_fixture.py` to drop a real page in, and every parser
    test below starts asserting against the live markup instead.
    """
    recorded = sorted(FIXTURES.glob("company_*.html"))
    recorded = [p for p in recorded if p.name != "company_synthetic.html"]
    if recorded:
        return recorded[0].read_text(encoding="utf-8")
    return _load("company_synthetic.html")


@pytest.fixture(scope="session")
def synthetic_html() -> str:
    return _load("company_synthetic.html")
