/**
 * Chittorgarh.com adapter — Tier 3 secondary source.
 *
 * Chittorgarh publishes mainboard IPO listings and, per IPO, anchor
 * investor lock-in end dates ("Anchor lock-in period end date (30 days /
 * 90 days)"). As a Tier 3 source its dates are used for discovery and
 * cross-checking only — they never override a primary source.
 *
 * Parsing is label-based (finds "lock-in ... end date" table rows and the
 * date next to them) rather than CSS-selector based, so modest layout
 * changes degrade to "no data found", never to wrong data. All requests
 * go through politeFetch: robots.txt respected, rate-limited, cached,
 * marked unavailable on 403/429 instead of evading.
 */

import { parseIndianDate } from "../engine/normalize";
import { politeFetch } from "./http";
import { extractLockInsFromText, extractionToObservation } from "./lockin-parser";
import type {
  AdapterContext,
  AdapterIpoResult,
  DiscoveredIpo,
  LockInObservation,
  SourceAdapter,
} from "./types";

const BASE = "https://www.chittorgarh.com";
// Mainboard IPO list report (stable report id used by the site for years).
const LIST_URL = `${BASE}/report/mainboard-ipo-list-in-india-bse-nse/83/`;
// Politeness cap: at most this many IPO detail pages per sync run.
const MAX_DETAIL_PAGES = 40;

const stripTags = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#\d+;|&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

interface ListRow {
  ipo: DiscoveredIpo;
  detailUrl: string | null;
}

export class ChittorgarhAdapter implements SourceAdapter {
  readonly key = "chittorgarh";
  readonly name = "Chittorgarh";
  readonly tier = "TIER3_SECONDARY" as const;

  private detailUrls = new Map<string, string>(); // companyName -> detail URL

  async discover(ctx: AdapterContext): Promise<DiscoveredIpo[]> {
    ctx.log("Chittorgarh: fetching mainboard IPO list");
    const html = await politeFetch(LIST_URL, { sourceName: this.name });
    const rows = this.parseListPage(html);
    this.detailUrls = new Map(
      rows.filter((r) => r.detailUrl).map((r) => [r.ipo.companyName, r.detailUrl as string]),
    );
    return rows.map((r) => r.ipo);
  }

  /** Parse the IPO list table. Exposed for fixture-based tests. */
  parseListPage(html: string): ListRow[] {
    const out: ListRow[] = [];
    const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
    for (const row of rows) {
      const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
      if (cells.length < 3) continue;

      const first = cells[0];
      const name = stripTags(first);
      if (!name || name.length < 4) continue;

      const href = /href="([^"]+)"/i.exec(first)?.[1] ?? null;
      const detailUrl = href ? (href.startsWith("http") ? href : `${BASE}${href}`) : null;

      // Collect any parseable dates from the remaining cells, in order.
      const texts = cells.slice(1).map(stripTags);
      const dates = texts.map((t) => parseIndianDate(t)).filter((d): d is string => d !== null);
      if (dates.length === 0) continue; // header/ad rows

      // Numeric cells: price is typically a smaller number, issue size (Cr) larger.
      const numbers = texts
        .filter((t) => /^[\d,]+(\.\d+)?$/.test(t.replace(/[₹\s]/g, "")))
        .map((t) => Number(t.replace(/[₹,\s]/g, "")))
        .filter((n) => Number.isFinite(n) && n > 0);

      const cleanName = name.replace(/\s*IPO$/i, "").trim();
      out.push({
        detailUrl,
        ipo: {
          companyName: cleanName,
          ipoName: `${cleanName} IPO`,
          exchange: "NSE,BSE",
          issueOpenDate: dates[0],
          issueCloseDate: dates[1],
          listingDate: dates[2],
          issuePrice: numbers.length ? numbers[0] : undefined,
          issueSizeCr: numbers.length > 1 ? numbers[numbers.length - 1] : undefined,
          status: "LISTED",
        },
      });
    }
    return out;
  }

  async fetchLockIns(ipos: DiscoveredIpo[], ctx: AdapterContext): Promise<AdapterIpoResult[]> {
    const results: AdapterIpoResult[] = [];
    let fetched = 0;
    for (const ipo of ipos) {
      if (fetched >= MAX_DETAIL_PAGES) {
        ctx.log(`Chittorgarh: politeness cap reached (${MAX_DETAIL_PAGES} detail pages); remaining IPOs deferred to next sync`);
        break;
      }
      const url = this.detailUrls.get(ipo.companyName);
      if (!url) continue;
      try {
        fetched++;
        const html = await politeFetch(url, { sourceName: this.name });
        const observations = this.parseDetailPage(html, url, ipo);
        if (observations.length) results.push({ ipo, observations });
      } catch (err) {
        if ((err as Error).name === "SourceUnavailableError") throw err;
        ctx.log(`Chittorgarh: ${ipo.companyName}: ${(err as Error).message}`);
      }
    }
    return results;
  }

  /** Extract anchor lock-in end dates from an IPO detail/anchor page. Exposed for tests. */
  parseDetailPage(html: string, url: string, ipo: DiscoveredIpo): LockInObservation[] {
    const observations: LockInObservation[] = [];
    const retrievedAt = new Date().toISOString();
    const title = stripTags(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "") || `Chittorgarh — ${ipo.companyName}`;

    // Structured pass: label/value table rows mentioning anchor lock-in end dates.
    const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
    const seen = new Set<string>();
    for (const row of rows) {
      const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => stripTags(m[1]));
      if (cells.length < 2) continue;
      const label = cells[0];
      if (!/anchor/i.test(label) || !/lock[-\s]?in/i.test(label) || !/end\s*date/i.test(label)) continue;

      const value = cells.slice(1).find((c) => parseIndianDate(c) !== null);
      const date = value ? parseIndianDate(value) : null;
      if (!date) continue;

      const isFirstTranche = /30\s*days|50\s*%/i.test(label);
      const isRemaining = /90\s*days|remaining/i.test(label);
      const category = isRemaining ? "ANCHOR_REMAINING" : isFirstTranche ? "ANCHOR_50PCT" : null;
      if (!category || seen.has(category)) continue;
      seen.add(category);

      observations.push({
        category,
        holderType:
          category === "ANCHOR_50PCT"
            ? "Anchor investors (50% tranche)"
            : "Anchor investors (remaining tranche)",
        publishedExpiryDate: date,
        ruleText: `${label}: ${value}`,
        evidence: {
          url,
          documentTitle: title,
          publishedDate: null,
          retrievedAt,
          extractedText: `${label}: ${value}`,
          parserConfidence: 0.85,
          raw: { label, value },
        },
      });
    }

    // Free-text fallback for pages without a structured table.
    if (observations.length === 0) {
      for (const x of extractLockInsFromText(stripTags(html))) {
        observations.push(
          extractionToObservation(x, { url, documentTitle: title, publishedDate: null, retrievedAt }),
        );
      }
    }
    return observations;
  }
}
