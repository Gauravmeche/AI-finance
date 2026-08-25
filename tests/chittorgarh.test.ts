import { describe, expect, it } from "vitest";
import { ChittorgarhAdapter } from "../src/lib/adapters/chittorgarh";

// Mocked HTML fixtures modeled on Chittorgarh's table layouts — unit tests
// never touch the live website.

const LIST_FIXTURE = `
<table class="table">
  <tr><th>Issuer Company</th><th>Open Date</th><th>Close Date</th><th>Listing Date</th><th>Issue Price (Rs)</th><th>Issue Size (Rs Cr)</th></tr>
  <tr>
    <td><a href="/ipo/sunrise-agro-ipo/1234/">Sunrise Agro Ltd IPO</a></td>
    <td>Aug 12, 2026</td><td>Aug 14, 2026</td><td>Aug 20, 2026</td>
    <td>250</td><td>1,850.50</td>
  </tr>
  <tr>
    <td><a href="https://www.chittorgarh.com/ipo/bluepeak-metals-ipo/5678/">Bluepeak Metals Ltd IPO</a></td>
    <td>Jul 01, 2026</td><td>Jul 03, 2026</td><td>Jul 09, 2026</td>
    <td>92</td><td>640</td>
  </tr>
  <tr><td>Advertisement</td><td>sponsored content</td><td>x</td></tr>
</table>`;

const DETAIL_FIXTURE = `
<html><head><title>Sunrise Agro Ltd IPO Anchor Investors - Chittorgarh</title></head><body>
<table class="table">
  <tr><td>Anchor Bid Date</td><td>Aug 11, 2026</td></tr>
  <tr><td>Anchor lock-in period end date (30 days)</td><td>Sep 17, 2026</td></tr>
  <tr><td>Anchor lock-in period end date (90 days)</td><td>Nov 16, 2026</td></tr>
</table>
</body></html>`;

// JSON payload fixture modeled on the webnodejs.chittorgarh.com report API.
const JSON_FIXTURE = JSON.stringify({
  curpg: 1,
  reportTableData: [
    {
      Sr: 1,
      "Issuer Company": '<a href="/ipo/sunrise-agro-ipo/1234/" title="Sunrise Agro IPO">Sunrise Agro Ltd IPO</a>',
      "Open Date": "Aug 12, 2026",
      "Close Date": "Aug 14, 2026",
      "Listing Date": "Aug 20, 2026",
      "Issue Price (Rs)": "250.00",
      "Issue Size (Rs Cr)": "1,850.50",
    },
    {
      Sr: 2,
      "Issuer Company": '<a href="https://www.chittorgarh.com/ipo/bluepeak-metals-ipo/5678/">Bluepeak Metals Ltd IPO</a>',
      "Open Date": "Jul 01, 2026",
      "Close Date": "Jul 03, 2026",
      "Listing Date": "Jul 09, 2026",
      "Issue Price (Rs)": "92",
      "Issue Size (Rs Cr)": "640",
    },
  ],
});

describe("Chittorgarh report JSON parsing (fixture)", () => {
  it("parses reportTableData rows with dates, price, size and detail URLs", () => {
    const rows = new ChittorgarhAdapter().parseReportJson(JSON_FIXTURE);
    expect(rows).toHaveLength(2);
    expect(rows[0].ipo.companyName).toBe("Sunrise Agro Ltd");
    expect(rows[0].ipo.listingDate).toBe("2026-08-20");
    expect(rows[0].ipo.issuePrice).toBe(250);
    expect(rows[0].ipo.issueSizeCr).toBe(1850.5);
    expect(rows[0].detailUrl).toBe("https://www.chittorgarh.com/ipo/sunrise-agro-ipo/1234/");
    expect(rows[1].detailUrl).toBe("https://www.chittorgarh.com/ipo/bluepeak-metals-ipo/5678/");
  });

  it("returns nothing for non-JSON or unrecognized payloads — no fabrication", () => {
    const adapter = new ChittorgarhAdapter();
    expect(adapter.parseReportJson("<html>not json</html>")).toHaveLength(0);
    expect(adapter.parseReportJson(JSON.stringify({ foo: [1, 2, 3] }))).toHaveLength(0);
  });
});

describe("Chittorgarh list page parsing (fixture)", () => {
  it("parses IPO rows with dates, price and size; skips ad rows", () => {
    const rows = new ChittorgarhAdapter().parseListPage(LIST_FIXTURE);
    expect(rows).toHaveLength(2);

    const sunrise = rows[0];
    expect(sunrise.ipo.companyName).toBe("Sunrise Agro Ltd");
    expect(sunrise.ipo.issueOpenDate).toBe("2026-08-12");
    expect(sunrise.ipo.issueCloseDate).toBe("2026-08-14");
    expect(sunrise.ipo.listingDate).toBe("2026-08-20");
    expect(sunrise.ipo.issuePrice).toBe(250);
    expect(sunrise.ipo.issueSizeCr).toBe(1850.5);
    expect(sunrise.detailUrl).toBe("https://www.chittorgarh.com/ipo/sunrise-agro-ipo/1234/");

    expect(rows[1].ipo.companyName).toBe("Bluepeak Metals Ltd");
    expect(rows[1].detailUrl).toBe("https://www.chittorgarh.com/ipo/bluepeak-metals-ipo/5678/");
  });
});

describe("Chittorgarh detail page anchor lock-in extraction (fixture)", () => {
  const adapter = new ChittorgarhAdapter();
  const ipo = { companyName: "Sunrise Agro Ltd", ipoName: "Sunrise Agro Ltd IPO" };

  it("extracts both anchor tranches with published end dates and evidence", () => {
    const obs = adapter.parseDetailPage(DETAIL_FIXTURE, "https://example.org/detail", ipo);
    expect(obs).toHaveLength(2);

    const first = obs.find((o) => o.category === "ANCHOR_50PCT")!;
    expect(first.publishedExpiryDate).toBe("2026-09-17");
    expect(first.evidence.parserConfidence).toBe(0.85);
    expect(first.evidence.extractedText).toContain("Anchor lock-in period end date (30 days)");

    const remaining = obs.find((o) => o.category === "ANCHOR_REMAINING")!;
    expect(remaining.publishedExpiryDate).toBe("2026-11-16");
  });

  it("extracts nothing from a page without lock-in data — no fabrication", () => {
    const obs = adapter.parseDetailPage(
      "<html><body><table><tr><td>Issue Price</td><td>250</td></tr></table></body></html>",
      "https://example.org/detail",
      ipo,
    );
    expect(obs).toHaveLength(0);
  });

  it("extracts anchor end dates from non-table free text", () => {
    const obs = adapter.parseDetailPage(
      `<html><body><div>Anchor lock-in period end date (30 days) Sep 17, 2026</div>
       <div>Anchor lock-in period end date (90 days): Nov 16, 2026</div></body></html>`,
      "https://example.org/detail",
      ipo,
    );
    expect(obs).toHaveLength(2);
    expect(obs.find((o) => o.category === "ANCHOR_50PCT")!.publishedExpiryDate).toBe("2026-09-17");
    expect(obs.find((o) => o.category === "ANCHOR_REMAINING")!.publishedExpiryDate).toBe("2026-11-16");
  });

  it("ignores a lock-in label whose value cell has no parseable date", () => {
    const obs = adapter.parseDetailPage(
      `<table><tr><td>Anchor lock-in period end date (30 days)</td><td>To be announced</td></tr></table>`,
      "https://example.org/detail",
      ipo,
    );
    expect(obs).toHaveLength(0);
  });
});
