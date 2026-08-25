/**
 * NSE (National Stock Exchange of India) adapter — Tier 1 primary source.
 *
 * Uses NSE's public JSON endpoints for IPO issue data. NSE applies
 * anti-automation controls; when access is denied the adapter marks the
 * source unavailable rather than attempting any workaround.
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

const BASE = "https://www.nseindia.com";

interface NsePastIssue {
  companyName?: string;
  symbol?: string;
  isin?: string;
  issueStartDate?: string;
  issueEndDate?: string;
  listingDate?: string;
  issuePrice?: string;
  issueSize?: string;
  series?: string;
}

export class NSEAdapter implements SourceAdapter {
  readonly key = "nse";
  readonly name = "NSE India";
  readonly tier = "TIER1_PRIMARY" as const;

  async discover(ctx: AdapterContext): Promise<DiscoveredIpo[]> {
    ctx.log("NSE: fetching past IPO issues");
    const body = await politeFetch(`${BASE}/api/public-past-issues`, {
      sourceName: this.name,
      headers: { accept: "application/json", referer: `${BASE}/market-data/all-upcoming-issues-ipo` },
    });
    let parsed: { data?: NsePastIssue[] };
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new Error("NSE: response was not valid JSON (page layout may have changed)");
    }
    const rows = parsed.data ?? [];
    return rows
      .filter((r) => r.companyName && (r.series === "EQ" || !r.series))
      .map((r) => ({
        companyName: r.companyName as string,
        ipoName: `${r.companyName} IPO`,
        ticker: r.symbol,
        isin: r.isin,
        exchange: "NSE",
        issueOpenDate: r.issueStartDate ? (parseIndianDate(r.issueStartDate) ?? undefined) : undefined,
        issueCloseDate: r.issueEndDate ? (parseIndianDate(r.issueEndDate) ?? undefined) : undefined,
        listingDate: r.listingDate ? (parseIndianDate(r.listingDate) ?? undefined) : undefined,
        issuePrice: r.issuePrice ? Number(String(r.issuePrice).replace(/[^\d.]/g, "")) || undefined : undefined,
        status: "LISTED" as const,
      }));
  }

  async fetchLockIns(ipos: DiscoveredIpo[], ctx: AdapterContext): Promise<AdapterIpoResult[]> {
    // NSE circulars/announcements mention lock-in expiries for listed
    // companies. We check the equity announcements feed per symbol.
    const results: AdapterIpoResult[] = [];
    for (const ipo of ipos) {
      if (!ipo.ticker) continue;
      try {
        const url = `${BASE}/api/corporate-announcements?index=equities&symbol=${encodeURIComponent(ipo.ticker)}`;
        const body = await politeFetch(url, {
          sourceName: this.name,
          headers: { accept: "application/json", referer: `${BASE}/companies-listing/corporate-filings-announcements` },
        });
        const rows: { desc?: string; attchmntText?: string; an_dt?: string; attchmntFile?: string }[] =
          JSON.parse(body);
        const observations = rows
          .filter((r) => /lock[-\s]?in/i.test(`${r.desc ?? ""} ${r.attchmntText ?? ""}`))
          .flatMap((r) =>
            extractLockInsFromText(r.attchmntText ?? r.desc ?? "").map((x) =>
              extractionToObservation(x, {
                url: r.attchmntFile ?? url,
                documentTitle: r.desc,
                publishedDate: r.an_dt ? (parseIndianDate(r.an_dt.slice(0, 11)) ?? null) : null,
                retrievedAt: new Date().toISOString(),
              }),
            ),
          );
        if (observations.length) results.push({ ipo, observations });
      } catch (err) {
        // Per-symbol failures are logged and skipped; a source-level block
        // (SourceUnavailableError) propagates so the engine records it once.
        if ((err as Error).name === "SourceUnavailableError") throw err;
        ctx.log(`NSE: ${ipo.ticker}: ${(err as Error).message}`);
      }
    }
    return results;
  }
}
