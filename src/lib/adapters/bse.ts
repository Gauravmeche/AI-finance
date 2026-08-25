/**
 * BSE (Bombay Stock Exchange) adapter — Tier 1 primary source.
 *
 * Reads BSE's public IPO listing pages. Like all adapters it degrades to
 * SOURCE_UNAVAILABLE when the site restricts automated access.
 */

import { parseIndianDate } from "../engine/normalize";
import { politeFetch } from "./http";
import { extractLockInsFromText, extractionToObservation } from "./lockin-parser";
import type {
  AdapterContext,
  AdapterIpoResult,
  DiscoveredIpo,
  SourceAdapter,
} from "./types";

const BASE = "https://www.bseindia.com";

export class BSEAdapter implements SourceAdapter {
  readonly key = "bse";
  readonly name = "BSE India";
  readonly tier = "TIER1_PRIMARY" as const;

  async discover(ctx: AdapterContext): Promise<DiscoveredIpo[]> {
    ctx.log("BSE: fetching public issues page");
    const body = await politeFetch(`${BASE}/publicissue.html`, { sourceName: this.name });
    return this.parseIssueTable(body);
  }

  /** Parse the listed-issues HTML table. Exposed for fixture-based tests. */
  parseIssueTable(html: string): DiscoveredIpo[] {
    const ipos: DiscoveredIpo[] = [];
    // Parse row-wise: BSE renders <tr> rows with company, dates, price.
    const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
    for (const row of rows) {
      const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) =>
        m[1]
          .replace(/<[^>]+>/g, "")
          .replace(/&amp;/g, "&")
          .replace(/&#\d+;|&[a-z]+;/gi, "") // currency/entity codes are not data
          .trim(),
      );
      if (cells.length < 4) continue;
      const [name, open, close, price] = cells;
      if (!name || /security|company/i.test(name)) continue;
      const openDate = parseIndianDate(open);
      if (!openDate) continue;
      ipos.push({
        companyName: name,
        ipoName: `${name} IPO`,
        exchange: "BSE",
        issueOpenDate: openDate,
        issueCloseDate: parseIndianDate(close) ?? undefined,
        issuePrice: price ? Number(price.replace(/[^\d.]/g, "")) || undefined : undefined,
        status: "LISTED",
      });
    }
    return ipos;
  }

  async fetchLockIns(ipos: DiscoveredIpo[], ctx: AdapterContext): Promise<AdapterIpoResult[]> {
    const results: AdapterIpoResult[] = [];
    for (const ipo of ipos) {
      if (!ipo.ticker && !ipo.companyName) continue;
      try {
        // BSE notices search (public) — lock-in expiry notices are published
        // as corporate announcements.
        const q = encodeURIComponent(ipo.companyName);
        const url = `${BASE}/corporates/ann.html?scrip=${q}`;
        const body = await politeFetch(url, { sourceName: this.name });
        const text = body.replace(/<[^>]+>/g, " ");
        const observations = extractLockInsFromText(text).map((x) =>
          extractionToObservation(x, {
            url,
            documentTitle: `BSE announcements — ${ipo.companyName}`,
            publishedDate: null,
            retrievedAt: new Date().toISOString(),
          }),
        );
        if (observations.length) results.push({ ipo, observations });
      } catch (err) {
        if ((err as Error).name === "SourceUnavailableError") throw err;
        ctx.log(`BSE: ${ipo.companyName}: ${(err as Error).message}`);
      }
    }
    return results;
  }
}
