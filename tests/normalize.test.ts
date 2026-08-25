import { describe, expect, it } from "vitest";
import { matchCompanies, normalizeCompanyName, parseIndianDate } from "../src/lib/engine/normalize";

describe("entity normalization / duplicate detection", () => {
  it("normalizes corporate suffixes and abbreviations", () => {
    expect(normalizeCompanyName("ABC Technologies Ltd.")).toBe(normalizeCompanyName("ABC Tech Limited"));
    expect(normalizeCompanyName("ABC Technologies")).toBe(normalizeCompanyName("ABC Technologies Ltd."));
  });

  it("prefers ISIN over everything: same ISIN matches, different ISIN never matches", () => {
    expect(
      matchCompanies(
        { name: "ABC Technologies Ltd.", isin: "INE123A01011" },
        { name: "Completely Different Name", isin: "INE123A01011" },
      ),
    ).toBe("isin");
    expect(
      matchCompanies(
        { name: "ABC Technologies Ltd.", isin: "INE123A01011" },
        { name: "ABC Technologies Ltd.", isin: "INE999Z09999" },
      ),
    ).toBe("none");
  });

  it("matches on ticker when ISIN is unavailable", () => {
    expect(
      matchCompanies({ name: "ABC Tech Limited", ticker: "ABCTECH" }, { name: "ABC Technologies", ticker: "abctech" }),
    ).toBe("ticker");
  });

  it("name match strengthened by listing date; broken by conflicting dates (duplicate IPO detection)", () => {
    expect(
      matchCompanies(
        { name: "ABC Technologies Ltd.", listingDate: "2026-05-15" },
        { name: "ABC Tech Limited", listingDate: "2026-05-15" },
      ),
    ).toBe("name_and_date");
    expect(
      matchCompanies(
        { name: "ABC Technologies Ltd.", listingDate: "2026-05-15" },
        { name: "ABC Tech Limited", listingDate: "2024-01-02" },
      ),
    ).toBe("none");
  });

  it("reports weak name-only matches distinctly", () => {
    expect(matchCompanies({ name: "ABC Technologies Ltd." }, { name: "ABC Tech Limited" })).toBe("name");
  });
});

describe("Indian date parsing", () => {
  it("parses common formats to ISO", () => {
    expect(parseIndianDate("15 May 2026")).toBe("2026-05-15");
    expect(parseIndianDate("15-May-2026")).toBe("2026-05-15");
    expect(parseIndianDate("15-May-26")).toBe("2026-05-15");
    expect(parseIndianDate("May 15, 2026")).toBe("2026-05-15");
    expect(parseIndianDate("15/05/2026")).toBe("2026-05-15");
    expect(parseIndianDate("2026-05-15")).toBe("2026-05-15");
  });

  it("rejects garbage and impossible dates", () => {
    expect(parseIndianDate("not a date")).toBeNull();
    expect(parseIndianDate("32/13/2026")).toBeNull();
    expect(parseIndianDate("30 Feb 2026")).toBeNull();
  });
});
