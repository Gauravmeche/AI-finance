import { describe, expect, it } from "vitest";
import { extractLockInsFromText } from "../src/lib/adapters/lockin-parser";

// Mocked prospectus-style fixture text — no live websites in unit tests.
const PROSPECTUS_FIXTURE = `
Details of the Offer

In accordance with applicable regulations, 50% of the Equity Shares allotted to Anchor Investors
shall be locked-in for a period of 30 days from the date of Allotment, i.e. until 10 July 2026,
and the remaining Equity Shares allotted to Anchor Investors shall be locked-in for a period of
90 days from the date of Allotment.

Our Promoter's minimum contribution of 20% of the post-Offer paid-up Equity Share capital shall be
locked-in for a period of 18 months from the date of Allotment.

The entire pre-IPO Equity Share capital held by shareholders other than our Promoter will be
locked-in for a period of 6 months from the date of Allotment.
`;

describe("prospectus / document lock-in extraction", () => {
  it("extracts anchor, promoter and pre-IPO categories with periods from fixture text", () => {
    const results = extractLockInsFromText(PROSPECTUS_FIXTURE);
    const categories = results.map((r) => r.category);
    expect(categories).toContain("ANCHOR_50PCT");
    expect(categories).toContain("PROMOTER_MINIMUM_CONTRIBUTION");
    expect(categories).toContain("PRE_IPO_SHAREHOLDER");

    const anchor = results.find((r) => r.category === "ANCHOR_50PCT")!;
    expect(anchor.lockInPeriod).toBe(30);
    expect(anchor.periodUnit).toBe("DAYS");
    expect(anchor.publishedExpiryDate).toBe("2026-07-10");
    expect(anchor.snippet.length).toBeGreaterThan(30); // evidence retained
    expect(anchor.parserConfidence).toBeGreaterThanOrEqual(0.8);

    const promoter = results.find((r) => r.category === "PROMOTER_MINIMUM_CONTRIBUTION")!;
    expect(promoter.lockInPeriod).toBe(18);
    expect(promoter.periodUnit).toBe("MONTHS");
  });

  it("marks approximate statements and never converts them to exact dates", () => {
    const results = extractLockInsFromText(
      "The shares held by Anchor Investors, being 50% of the anchor allocation, are locked-in for approximately 90 days from allotment.",
    );
    expect(results).toHaveLength(1);
    expect(results[0].isApproximate).toBe(true);
    expect(results[0].publishedExpiryDate).toBeNull();
    // Lower confidence for approximate statements
    expect(results[0].parserConfidence).toBeLessThan(0.8);
  });

  it("extracts nothing when no usable period or date is stated — no fabrication", () => {
    const results = extractLockInsFromText(
      "The promoter minimum contribution shall be subject to lock-in as per applicable SEBI regulations.",
    );
    expect(results).toHaveLength(0);
  });

  it("ignores text without lock-in context", () => {
    expect(extractLockInsFromText("The company manufactures precision tools and reported revenue growth of 30 percent over 90 days of operations.")).toHaveLength(0);
  });
});
