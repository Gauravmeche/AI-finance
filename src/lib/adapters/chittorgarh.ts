/**
 * Chittorgarh.com adapter — Tier 3 secondary source.
 *
 * Chittorgarh publishes mainboard IPO listings and, per IPO, anchor
 * investor lock-in end dates ("Anchor lock-in period end date (30 days /
 * 90 days)"). As a Tier 3 source its dates are used for discovery and
 * cross-checking only — they never override a primary source.
 *
 * The site's report tables are rendered client-side from a JSON API
 * (webnodejs.chittorgarh.com), so discovery tries the server HTML table
 * first and falls back to the JSON endpoint, preferring the endpoint URL
 * found in the page's own scripts over a constructed one. Parsing is
 * label-based, so layout changes degrade to "no data found", never to
 * wrong data. All requests go through politeFetch: robots.txt respected,
 * rate-limited, cached, marked unavailable on 403/429 instead of evading.
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
const DATA_HOST = "https://webnodejs.chittorgarh.com";
// Politeness cap: at most this many page fetches for lock-in data per sync.
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
    ctx.log("Chittorgarh: fetching mainboard IPO list page");
    const html = await politeFetch(LIST_URL, { sourceName: this.name });
    let rows = this.parseListPage(html);
    ctx.log(`Chittorgarh: HTML table pass found ${rows.length} IPO rows (page ${html.length} bytes)`);

    if (rows.length === 0) {
      // The table is rendered client-side — fetch the JSON data endpoint.
      rows = await this.discoverViaJson(html, ctx);
    }

    this.detailUrls = new Map(
      rows.filter((r) => r.detailUrl).map((r) => [r.ipo.companyName, r.detailUrl as string]),
    );
    return rows.map((r) => r.ipo);
  }

  /** Find the report data endpoint (from the page's own scripts if possible) and parse its JSON. */
  private async discoverViaJson(html: string, ctx: AdapterContext): Promise<ListRow[]> {
    const candidates: string[] = [];

    // 1) Endpoint referenced by the page itself (most reliable).
    for (const m of html.matchAll(/https?:\/\/webnodejs\.chittorgarh\.com\/[^"'\\\s]+/gi)) {
      candidates.push(m[0]);
    }
    ctx.log(`Chittorgarh: found ${candidates.length} data-endpoint URL(s) in page scripts`);

    // 2) Constructed fallbacks for the known data-read pattern:
    //    /cloud/report/data-read/{reportId}/{page}/{month}/{year}/{fy}/0/all/0
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const fy = m >= 4 ? `${y}-${String((y + 1) % 100).padStart(2, "0")}` : `${y - 1}-${String(y % 100).padStart(2, "0")}`;
    candidates.push(
      `${DATA_HOST}/cloud/report/data-read/83/1/${m}/${y}/${fy}/0/all/0?search=&v=15-10`,
      `${DATA_HOST}/cloud/report/data-read/83/1/${m}/${y}/${fy}/0/all/0`,
    );

    for (const url of candidates.slice(0, 6)) {
      try {
        const body = await politeFetch(url, {
          sourceName: this.name,
          headers: { accept: "application/json", referer: LIST_URL },
        });
        const rows = this.parseReportJson(body);
        if (rows.length > 0) {
          ctx.log(`Chittorgarh: JSON endpoint yielded ${rows.length} IPOs (${url.slice(0, 90)}…)`);
          return rows;
        }
        ctx.log(`Chittorgarh: endpoint returned no usable rows: ${url.slice(0, 90)}`);
      } catch (err) {
        ctx.log(`Chittorgarh: endpoint failed (${(err as Error).message.slice(0, 80)}): ${url.slice(0, 90)}`);
      }
    }
    ctx.log("Chittorgarh: no data endpoint worked — page layout may have changed; no IPOs discovered (nothing guessed)");
    return [];
  }

  /** Parse the report JSON payload. Exposed for fixture-based tests. */
  parseReportJson(body: string): ListRow[] {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return [];
    }

    // Find the row array: reportTableData, or any array-of-objects value.
    let rows: Record<string, unknown>[] | null = null;
    const scan = (v: unknown): void => {
      if (rows) return;
      if (Array.isArray(v) && v.length > 0 && typeof v[0] === "object" && v[0] !== null) {
        const keys = Object.keys(v[0] as object).map((k) => k.toLowerCase());
        if (keys.some((k) => k.includes("company") || k.includes("issuer"))) {
          rows = v as Record<string, unknown>[];
        }
      } else if (typeof v === "object" && v !== null) {
        for (const val of Object.values(v)) scan(val);
      }
    };
    scan(parsed);
    if (!rows) return [];

    const out: ListRow[] = [];
    for (const row of rows as Record<string, unknown>[]) {
      const get = (frag: string): string | null => {
        const key = Object.keys(row).find((k) => k.toLowerCase().includes(frag));
        const v = key != null ? row[key] : null;
        return v == null ? null : String(v);
      };

      const companyRaw = get("company") ?? get("issuer");
      if (!companyRaw) continue;
      const href = /href=["']([^"']+)["']/i.exec(companyRaw)?.[1] ?? null;
      const name = stripTags(companyRaw).replace(/\s*IPO$/i, "").trim();
      if (!name || name.length < 3) continue;

      const parseDateField = (frag: string) => {
        const v = get(frag);
        return v ? (parseIndianDate(stripTags(v)) ?? undefined) : undefined;
      };
      const parseNumField = (frag: string) => {
        const v = get(frag);
        if (!v) return undefined;
        const n = Number(stripTags(v).replace(/[₹,\s]/g, ""));
        return Number.isFinite(n) && n > 0 ? n : undefined;
      };

      out.push({
        detailUrl: href ? (href.startsWith("http") ? href : `${BASE}${href.startsWith("/") ? "" : "/"}${href}`) : null,
        ipo: {
          companyName: name,
          ipoName: `${name} IPO`,
          exchange: "NSE,BSE",
          issueOpenDate: parseDateField("open"),
          issueCloseDate: parseDateField("clos"),
          listingDate: parseDateField("listing"),
          issuePrice: parseNumField("price"),
          issueSizeCr: parseNumField("size"),
          status: "LISTED",
        },
      });
    }
    return out;
  }

  /** Parse a server-rendered IPO list table. Exposed for fixture-based tests. */
  parseListPage(html: string): ListRow[] {
    const out: ListRow[] = [];
    const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
    for (const row of rows) {
      const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
      if (cells.length < 3) continue;

      const first = cells[0];
      const name = stripTags(first).replace(/\s*IPO$/i, "").trim();
      if (!name || name.length < 4) continue;

      const href = /href="([^"]+)"/i.exec(first)?.[1] ?? null;
      const detailUrl = href ? (href.startsWith("http") ? href : `${BASE}${href}`) : null;

      const texts = cells.slice(1).map(stripTags);
      const dates = texts.map((t) => parseIndianDate(t)).filter((d): d is string => d !== null);
      if (dates.length === 0) continue; // header/ad rows

      const numbers = texts
        .filter((t) => /^[\d,]+(\.\d+)?$/.test(t.replace(/[₹\s]/g, "")))
        .map((t) => Number(t.replace(/[₹,\s]/g, "")))
        .filter((n) => Number.isFinite(n) && n > 0);

      out.push({
        detailUrl,
        ipo: {
          companyName: name,
          ipoName: `${name} IPO`,
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
        ctx.log(`Chittorgarh: politeness cap reached (${MAX_DETAIL_PAGES} pages); remaining IPOs deferred to next sync`);
        break;
      }
      const url = this.detailUrls.get(ipo.companyName);
      if (!url) continue;
      try {
        fetched++;
        const html = await politeFetch(url, { sourceName: this.name });
        let observations = this.parseDetailPage(html, url, ipo);

        // Anchor lock-in dates usually live on the linked anchor-investors
        // page rather than the main IPO page — follow it if present.
        if (observations.length === 0 && fetched < MAX_DETAIL_PAGES) {
          const anchorHref = [...html.matchAll(/href="([^"]*anchor[^"]*)"/gi)]
            .map((m) => m[1])
            .find((h) => !/#|javascript:/i.test(h));
          if (anchorHref) {
            const anchorUrl = anchorHref.startsWith("http") ? anchorHref : `${BASE}${anchorHref.startsWith("/") ? "" : "/"}${anchorHref}`;
            fetched++;
            const anchorHtml = await politeFetch(anchorUrl, { sourceName: this.name });
            observations = this.parseDetailPage(anchorHtml, anchorUrl, ipo);
            ctx.log(`Chittorgarh: ${ipo.companyName}: anchor page ${observations.length ? `yielded ${observations.length} lock-in dates` : "had no parseable lock-in dates"}`);
          }
        }
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
    const seen = new Set<string>();

    const record = (category: "ANCHOR_50PCT" | "ANCHOR_REMAINING", date: string, label: string, confidence: number) => {
      if (seen.has(category)) return;
      seen.add(category);
      observations.push({
        category,
        holderType:
          category === "ANCHOR_50PCT" ? "Anchor investors (50% tranche)" : "Anchor investors (remaining tranche)",
        publishedExpiryDate: date,
        ruleText: label,
        evidence: {
          url,
          documentTitle: title,
          publishedDate: null,
          retrievedAt,
          extractedText: label,
          parserConfidence: confidence,
          raw: { label },
        },
      });
    };

    // Structured pass: label/value table rows mentioning anchor lock-in end dates.
    const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
    for (const row of rows) {
      const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => stripTags(c[1]));
      if (cells.length < 2) continue;
      const label = cells[0];
      if (!/anchor/i.test(label) || !/lock[-\s]?in/i.test(label) || !/end\s*date/i.test(label)) continue;
      const value = cells.slice(1).find((c) => parseIndianDate(c) !== null);
      const date = value ? parseIndianDate(value) : null;
      if (!date) continue;
      const category = /90\s*days|remaining/i.test(label)
        ? "ANCHOR_REMAINING"
        : /30\s*days|50\s*%/i.test(label)
          ? "ANCHOR_50PCT"
          : null;
      if (category) record(category, date, `${label}: ${value}`, 0.85);
    }

    // Free-text pass: "Anchor lock-in period end date (30 days) Sep 17, 2026"
    // in non-table markup.
    if (observations.length === 0) {
      const text = stripTags(html);
      const pattern =
        /anchor[^.]{0,80}?lock[-\s]?in[^.]{0,80}?end\s*date[^A-Za-z0-9]{0,10}\(?\s*(30|90)\s*days?\)?\s*:?\s*((?:[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})|(?:\d{1,2}[\s\-/][A-Za-z]{3,9}[\s\-/,]+\d{2,4})|(?:\d{4}-\d{2}-\d{2}))/gi;
      for (const m of text.matchAll(pattern)) {
        const date = parseIndianDate(m[2]);
        if (!date) continue;
        record(m[1] === "90" ? "ANCHOR_REMAINING" : "ANCHOR_50PCT", date, m[0].slice(0, 200), 0.7);
      }
    }

    // Last resort: generic lock-in statements (periods, promoter text…).
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
