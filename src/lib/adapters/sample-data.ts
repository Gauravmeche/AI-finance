/**
 * Demo dataset — clearly-labelled FICTIONAL Indian IPOs.
 *
 * This container/deployment may not have network access to live exchanges,
 * and the system must never present invented dates as real market data.
 * These fixtures therefore use fictional companies (isSampleData=true,
 * badged in the UI) and exist to exercise the full ingestion →
 * verification → dashboard pipeline, including agreements, discrepancies,
 * low parser confidence and unavailable sources.
 *
 * Three demo "sources" simulate the real source hierarchy:
 *   demo_exchange   (Tier 1 — exchange filing)
 *   demo_prospectus (Tier 1 — RHP/prospectus repository)
 *   demo_portal     (Tier 3 — financial portal)
 */

import { addDays, addMonths, todayIso } from "../engine/dates";
import type { AdapterIpoResult, DiscoveredIpo, LockInObservation } from "./types";

export type SamplePersona = "demo_exchange" | "demo_prospectus" | "demo_portal";

interface EventSpec {
  category: LockInObservation["category"];
  holderType: string;
  shares: number;
  percentage: number;
  period: number;
  unit: "DAYS" | "MONTHS";
  /** Which personas publish an explicit expiry date for this event. */
  publishers: SamplePersona[];
  /** Persona → day offset applied to the true expiry (creates discrepancies). */
  skew?: Partial<Record<SamplePersona, number>>;
  /** Persona → parser confidence override (default 0.9). */
  parseConf?: Partial<Record<SamplePersona, number>>;
  /** Personas that publish the period/rule but no explicit date. */
  periodOnly?: SamplePersona[];
}

interface IpoSpec {
  company: string;
  ticker: string;
  isin: string;
  exchange: string;
  listedDaysAgo: number;
  issuePrice: number;
  listingPrice: number;
  issueSizeCr: number;
  events: EventSpec[];
}

const ALL: SamplePersona[] = ["demo_exchange", "demo_prospectus", "demo_portal"];

// Anchor lock-ins run from allotment (listing - 3 days in these fixtures).
const UNIVERSE: IpoSpec[] = [
  {
    company: "Meridian Clean Energy Ltd.",
    ticker: "MERIDIAN",
    isin: "INE000DEMO011",
    exchange: "NSE,BSE",
    listedDaysAgo: 33,
    issuePrice: 420,
    listingPrice: 512,
    issueSizeCr: 2850,
    events: [
      { category: "ANCHOR_50PCT", holderType: "Anchor investors (50% tranche)", shares: 6_200_000, percentage: 4.1, period: 30, unit: "DAYS", publishers: ALL },
      { category: "ANCHOR_REMAINING", holderType: "Anchor investors (remaining tranche)", shares: 6_200_000, percentage: 4.1, period: 90, unit: "DAYS", publishers: ALL },
      { category: "PRE_IPO_SHAREHOLDER", holderType: "Pre-IPO shareholders (non-promoter)", shares: 41_000_000, percentage: 27.3, period: 6, unit: "MONTHS", publishers: ["demo_exchange", "demo_prospectus"] },
    ],
  },
  {
    company: "Suryakant Microfinance Ltd.",
    ticker: "SURYAMFI",
    isin: "INE000DEMO022",
    exchange: "NSE",
    listedDaysAgo: 85,
    issuePrice: 188,
    listingPrice: 174,
    issueSizeCr: 960,
    events: [
      { category: "ANCHOR_REMAINING", holderType: "Anchor investors (remaining tranche)", shares: 4_800_000, percentage: 5.6, period: 90, unit: "DAYS", publishers: ALL },
      { category: "PROMOTER_EXCESS", holderType: "Promoter (holding in excess of minimum contribution)", shares: 22_500_000, percentage: 26.4, period: 6, unit: "MONTHS", publishers: ["demo_exchange", "demo_prospectus"] },
    ],
  },
  {
    company: "Vindhya Rail Infrastructure Ltd.",
    ticker: "VINDHYARAIL",
    isin: "INE000DEMO033",
    exchange: "NSE,BSE",
    listedDaysAgo: 84,
    issuePrice: 76,
    listingPrice: 101,
    issueSizeCr: 1420,
    events: [
      // Portal reports one day later than the exchange → DATE_DISCREPANCY.
      { category: "ANCHOR_REMAINING", holderType: "Anchor investors (remaining tranche)", shares: 18_400_000, percentage: 7.2, period: 90, unit: "DAYS", publishers: ALL, skew: { demo_portal: 1 } },
    ],
  },
  {
    company: "Aurelia Diagnostics Ltd.",
    ticker: "AURELIA",
    isin: "INE000DEMO044",
    exchange: "BSE",
    listedDaysAgo: 63,
    issuePrice: 610,
    listingPrice: 655,
    issueSizeCr: 1875,
    events: [
      { category: "ANCHOR_REMAINING", holderType: "Anchor investors (remaining tranche)", shares: 2_950_000, percentage: 3.4, period: 90, unit: "DAYS", publishers: ["demo_portal"] },
      { category: "PRE_IPO_SHAREHOLDER", holderType: "Pre-IPO shareholders (non-promoter)", shares: 12_700_000, percentage: 18.9, period: 6, unit: "MONTHS", publishers: ["demo_exchange"] },
    ],
  },
  {
    company: "Kaveri Agro Sciences Ltd.",
    ticker: "KAVERIAGRO",
    isin: "INE000DEMO055",
    exchange: "NSE",
    listedDaysAgo: 45,
    issuePrice: 245,
    listingPrice: 289,
    issueSizeCr: 730,
    events: [
      // Prospectus states the period but no explicit date → CALCULATION_REQUIRED.
      { category: "ANCHOR_REMAINING", holderType: "Anchor investors (remaining tranche)", shares: 3_600_000, percentage: 4.8, period: 90, unit: "DAYS", publishers: [], periodOnly: ["demo_prospectus"] },
    ],
  },
  {
    company: "Nilgiri Foods & Beverages Ltd.",
    ticker: "NILGIRIFB",
    isin: "INE000DEMO066",
    exchange: "NSE,BSE",
    listedDaysAgo: 40,
    issuePrice: 92,
    listingPrice: 88,
    issueSizeCr: 540,
    events: [
      // Only a garbled low-confidence extraction exists → NEEDS_REVIEW, no date shown.
      { category: "OTHER", holderType: "Other shareholder lock-in (category unclear in source)", shares: 9_800_000, percentage: 21.0, period: 6, unit: "MONTHS", publishers: ["demo_portal"], parseConf: { demo_portal: 0.32 } },
    ],
  },
  {
    company: "Tricolor Fintech Ltd.",
    ticker: "TRICOLOR",
    isin: "INE000DEMO077",
    exchange: "NSE",
    listedDaysAgo: 81,
    issuePrice: 350,
    listingPrice: 402,
    issueSizeCr: 3200,
    events: [
      { category: "ANCHOR_REMAINING", holderType: "Anchor investors (remaining tranche)", shares: 8_100_000, percentage: 6.1, period: 90, unit: "DAYS", publishers: ALL },
      { category: "PROMOTER_MINIMUM_CONTRIBUTION", holderType: "Promoter (minimum contribution)", shares: 54_000_000, percentage: 20.0, period: 18, unit: "MONTHS", publishers: ["demo_exchange"] },
    ],
  },
  {
    company: "Deccan Precision Tools Ltd.",
    ticker: "DECCANPT",
    isin: "INE000DEMO088",
    exchange: "BSE",
    listedDaysAgo: 120,
    issuePrice: 132,
    listingPrice: 129,
    issueSizeCr: 410,
    events: [
      // Already expired — exercises the "Expired" state.
      { category: "ANCHOR_REMAINING", holderType: "Anchor investors (remaining tranche)", shares: 2_100_000, percentage: 3.0, period: 90, unit: "DAYS", publishers: ["demo_exchange", "demo_portal"] },
    ],
  },
];

const PERSONA_META: Record<SamplePersona, { urlBase: string; docTitle: (c: string) => string }> = {
  demo_exchange: {
    urlBase: "https://demo-exchange.example.org/filings",
    docTitle: (c) => `Exchange filing — ${c} lock-in schedule (DEMO DATA)`,
  },
  demo_prospectus: {
    urlBase: "https://demo-prospectus.example.org/rhp",
    docTitle: (c) => `Red Herring Prospectus extract — ${c} (DEMO DATA)`,
  },
  demo_portal: {
    urlBase: "https://demo-portal.example.org/ipo",
    docTitle: (c) => `IPO lock-in tracker page — ${c} (DEMO DATA)`,
  },
};

export function buildSampleUniverse(persona: SamplePersona, today = todayIso()): AdapterIpoResult[] {
  const meta = PERSONA_META[persona];
  const results: AdapterIpoResult[] = [];

  for (const spec of UNIVERSE) {
    const listingDate = addDays(today, -spec.listedDaysAgo);
    const allotmentDate = addDays(listingDate, -3);
    const ipo: DiscoveredIpo = {
      companyName: spec.company,
      ipoName: `${spec.company.replace(/ Ltd\.$/, "")} IPO`,
      ticker: spec.ticker,
      isin: spec.isin,
      exchange: spec.exchange,
      listingDate,
      allotmentDate,
      issueOpenDate: addDays(listingDate, -9),
      issueCloseDate: addDays(listingDate, -7),
      issuePrice: spec.issuePrice,
      listingPrice: spec.listingPrice,
      issueSizeCr: spec.issueSizeCr,
      status: "LISTED",
    };

    const observations: LockInObservation[] = [];
    for (const ev of spec.events) {
      const trueExpiry =
        ev.unit === "DAYS" ? addDays(allotmentDate, ev.period) : addMonths(allotmentDate, ev.period);

      const publishes = ev.publishers.includes(persona);
      const periodOnly = ev.periodOnly?.includes(persona) ?? false;
      if (!publishes && !periodOnly) continue;

      const skew = ev.skew?.[persona] ?? 0;
      const published = publishes ? addDays(trueExpiry, skew) : null;
      const parserConfidence = ev.parseConf?.[persona] ?? 0.9;
      // A garbled extraction yields no reliable period/start either — the
      // event must land as NEEDS_REVIEW with no date, never a guess.
      const garbled = parserConfidence < 0.5;

      observations.push({
        category: ev.category,
        holderType: ev.holderType,
        shares: ev.shares,
        percentage: ev.percentage,
        lockInPeriod: garbled ? null : ev.period,
        periodUnit: garbled ? null : ev.unit,
        startDate: garbled ? null : allotmentDate,
        publishedExpiryDate: published,
        ruleText: `${ev.holderType}: locked in for ${ev.period} ${ev.unit.toLowerCase()} from the date of allotment (as stated in demo documentation).`,
        evidence: {
          url: `${meta.urlBase}/${spec.ticker.toLowerCase()}`,
          documentTitle: meta.docTitle(spec.company),
          publishedDate: addDays(listingDate, 1),
          retrievedAt: new Date().toISOString(),
          extractedText: published
            ? `${ev.holderType} in respect of ${ev.shares.toLocaleString("en-IN")} equity shares (${ev.percentage}% of post-issue capital) are locked in for a period of ${ev.period} ${ev.unit.toLowerCase()} from the date of allotment, i.e. until ${published}. [FICTIONAL DEMO EVIDENCE]`
            : `${ev.holderType} are locked in for a period of ${ev.period} ${ev.unit.toLowerCase()} from the date of allotment. [FICTIONAL DEMO EVIDENCE]`,
          parserConfidence,
          raw: { demo: true, category: ev.category, persona },
        },
      });
    }
    if (observations.length) results.push({ ipo, observations });
  }
  return results;
}

export function sampleIpos(today = todayIso()): DiscoveredIpo[] {
  return buildSampleUniverse("demo_exchange", today).map((r) => r.ipo);
}
