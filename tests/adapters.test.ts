import { describe, expect, it } from "vitest";
import { BSEAdapter } from "../src/lib/adapters/bse";
import { buildSampleUniverse } from "../src/lib/adapters/sample-data";
import { isAllowedByRobots } from "../src/lib/adapters/http";

// Mocked HTML fixture — scraper unit tests never touch live websites.
const BSE_HTML_FIXTURE = `
<table>
  <tr><th>Security Name</th><th>Open</th><th>Close</th><th>Price</th></tr>
  <tr><td>Alpha Industries Ltd</td><td>12 May 2026</td><td>14 May 2026</td><td>&#8377;250</td></tr>
  <tr><td>Beta &amp; Gamma Foods Ltd</td><td>01/06/2026</td><td>03/06/2026</td><td>120</td></tr>
  <tr><td>garbage row</td><td>not a date</td><td>x</td><td>y</td></tr>
</table>`;

describe("BSE adapter HTML parsing (fixture)", () => {
  it("parses issue rows and skips unparseable ones", () => {
    const ipos = new BSEAdapter().parseIssueTable(BSE_HTML_FIXTURE);
    expect(ipos).toHaveLength(2);
    expect(ipos[0].companyName).toBe("Alpha Industries Ltd");
    expect(ipos[0].issueOpenDate).toBe("2026-05-12");
    expect(ipos[0].issueCloseDate).toBe("2026-05-14");
    expect(ipos[0].issuePrice).toBe(250);
    expect(ipos[1].companyName).toBe("Beta & Gamma Foods Ltd");
    expect(ipos[1].issueOpenDate).toBe("2026-06-01");
  });
});

describe("robots.txt compliance", () => {
  it("blocks disallowed paths", () => {
    expect(isAllowedByRobots(["/private", "/api/"], "/api/data")).toBe(false);
    expect(isAllowedByRobots(["/private"], "/publicissue.html")).toBe(true);
    expect(isAllowedByRobots([], "/anything")).toBe(true);
  });
});

describe("demo source personas", () => {
  const today = "2026-08-25";

  it("simulate independent sources over one universe (same ISINs, own evidence URLs)", () => {
    const exchange = buildSampleUniverse("demo_exchange", today);
    const portal = buildSampleUniverse("demo_portal", today);
    expect(exchange.length).toBeGreaterThan(0);
    // Companies covered by both personas must carry identical identifiers,
    // so the sync engine merges them into one IPO instead of duplicating.
    const meridianExchange = exchange.find((r) => r.ipo.ticker === "MERIDIAN")!;
    const meridianPortal = portal.find((r) => r.ipo.ticker === "MERIDIAN")!;
    expect(meridianPortal.ipo.isin).toBe(meridianExchange.ipo.isin);
    expect(meridianPortal.ipo.listingDate).toBe(meridianExchange.ipo.listingDate);
    expect(exchange[0].observations[0].evidence.url).toContain("demo-exchange");
    expect(portal[0].observations[0].evidence.url).toContain("demo-portal");
  });

  it("contains the deliberate one-day discrepancy for Vindhya Rail", () => {
    const exchange = buildSampleUniverse("demo_exchange", today).find((r) => r.ipo.ticker === "VINDHYARAIL")!;
    const portal = buildSampleUniverse("demo_portal", today).find((r) => r.ipo.ticker === "VINDHYARAIL")!;
    const a = exchange.observations[0].publishedExpiryDate!;
    const b = portal.observations[0].publishedExpiryDate!;
    expect(a).not.toBe(b);
    expect(new Date(b).getTime() - new Date(a).getTime()).toBe(86_400_000);
  });

  it("garbled extraction carries low confidence and no period — feeds the NEEDS_REVIEW path", () => {
    const portal = buildSampleUniverse("demo_portal", today).find((r) => r.ipo.ticker === "NILGIRIFB")!;
    const obs = portal.observations[0];
    expect(obs.evidence.parserConfidence).toBeLessThan(0.5);
    expect(obs.lockInPeriod).toBeNull();
    expect(obs.startDate).toBeNull();
  });
});
