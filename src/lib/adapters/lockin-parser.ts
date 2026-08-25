/**
 * Contextual lock-in extraction from document text (prospectus / RHP /
 * exchange PDFs after text extraction, or HTML pages after tag stripping).
 *
 * This is deliberately conservative: it extracts only what the text
 * actually states, attaches the backing snippet as evidence, and reports a
 * parser confidence. Low-confidence extractions are surfaced as NEEDS
 * REVIEW downstream — values are never fabricated.
 */

import { parseIndianDate } from "../engine/normalize";
import type { LockInCategory, LockInObservation, SourceEvidence } from "./types";

const CATEGORY_PATTERNS: { category: LockInCategory; holder: string; pattern: RegExp }[] = [
  {
    category: "ANCHOR_50PCT",
    holder: "Anchor investors (50% tranche)",
    pattern: /(?:50%|fifty\s+per\s?cent)[^.]{0,120}anchor|anchor[^.]{0,120}(?:50%|fifty\s+per\s?cent)/i,
  },
  {
    category: "ANCHOR_REMAINING",
    holder: "Anchor investors (remaining tranche)",
    pattern: /remaining[^.]{0,80}anchor|anchor[^.]{0,120}remaining/i,
  },
  {
    category: "PROMOTER_MINIMUM_CONTRIBUTION",
    holder: "Promoter (minimum contribution)",
    pattern: /promoter[^.]{0,160}minimum\s+(?:promoter'?s?\s+)?contribution|minimum\s+contribution[^.]{0,120}promoter/i,
  },
  {
    category: "PROMOTER_EXCESS",
    holder: "Promoter (holding in excess of minimum contribution)",
    pattern: /promoter[^.]{0,160}(?:in\s+)?excess\s+of\s+(?:the\s+)?minimum/i,
  },
  {
    category: "PRE_IPO_SHAREHOLDER",
    holder: "Pre-IPO shareholders (non-promoter)",
    pattern: /pre[-\s]?(?:ipo|issue)[^.]{0,140}(?:shareholder|capital|investor)/i,
  },
];

const PERIOD_PATTERN =
  /(?:lock[-\s]?in|locked[-\s]?in)[^.]{0,200}?(?:period\s+of\s+|for\s+(?:a\s+period\s+of\s+)?)?(\d{1,3})\s*(day|month|year)s?/i;

const DATE_NEAR_PATTERN =
  /(?:until|till|up\s?to|expir\w+\s+(?:on|date)?:?|ending\s+(?:on)?)\s*[:\s]*((?:\d{1,2}[\s\-/][A-Za-z]{3,9}[\s\-/,]+\d{2,4})|(?:[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})|(?:\d{4}-\d{2}-\d{2})|(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}))/i;

const SHARES_PATTERN = /([\d,]+(?:\.\d+)?)\s*(?:crore|cr|lakh|lakhs)?\s*(?:equity\s+)?shares/i;

export interface TextExtraction {
  category: LockInCategory;
  holderType: string;
  lockInPeriod: number | null;
  periodUnit: "DAYS" | "MONTHS" | "YEARS" | null;
  publishedExpiryDate: string | null;
  shares: number | null;
  snippet: string;
  parserConfidence: number;
  /** Marks "approximately X days" style statements — never silently exact. */
  isApproximate: boolean;
}

/** Split document text into paragraph-ish chunks for contextual parsing. */
function chunks(text: string): string[] {
  return text
    .split(/\n{2,}|\r\n{2,}|(?<=\.)\s{2,}/)
    .map((c) => c.replace(/\s+/g, " ").trim())
    .filter((c) => c.length > 30);
}

export function extractLockInsFromText(text: string): TextExtraction[] {
  const results: TextExtraction[] = [];
  const seen = new Set<string>();

  for (const chunk of chunks(text)) {
    if (!/lock[-\s]?in|locked[-\s]?in/i.test(chunk)) continue;

    for (const { category, holder, pattern } of CATEGORY_PATTERNS) {
      if (!pattern.test(chunk)) continue;
      if (seen.has(category)) continue;

      const periodMatch = PERIOD_PATTERN.exec(chunk);
      const dateMatch = DATE_NEAR_PATTERN.exec(chunk);
      const sharesMatch = SHARES_PATTERN.exec(chunk);
      const isApproximate = /approximately|about|around|circa/i.test(chunk);

      const publishedExpiryDate = dateMatch ? parseIndianDate(dateMatch[1]) : null;
      const lockInPeriod = periodMatch ? Number(periodMatch[1]) : null;
      const periodUnit = periodMatch
        ? ((periodMatch[2].toUpperCase() + "S") as "DAYS" | "MONTHS" | "YEARS")
        : null;

      let shares: number | null = null;
      if (sharesMatch) {
        const n = Number(sharesMatch[1].replace(/,/g, ""));
        const scale = /crore|cr/i.test(sharesMatch[0]) ? 1e7 : /lakh/i.test(sharesMatch[0]) ? 1e5 : 1;
        shares = Number.isFinite(n) ? Math.round(n * scale) : null;
      }

      // Confidence: category match alone is weak; a period or explicit date
      // in the same context strengthens it.
      let confidence = 0.4;
      if (lockInPeriod !== null) confidence += 0.25;
      if (publishedExpiryDate !== null) confidence += 0.3;
      if (isApproximate) confidence -= 0.15;
      confidence = Math.max(0, Math.min(1, confidence));

      if (lockInPeriod === null && publishedExpiryDate === null) continue; // nothing usable stated

      seen.add(category);
      results.push({
        category,
        holderType: holder,
        lockInPeriod,
        periodUnit,
        publishedExpiryDate,
        shares,
        snippet: chunk.slice(0, 500),
        parserConfidence: confidence,
        isApproximate,
      });
    }
  }
  return results;
}

export function extractionToObservation(
  x: TextExtraction,
  evidence: Omit<SourceEvidence, "extractedText" | "parserConfidence">,
): LockInObservation {
  return {
    category: x.category,
    holderType: x.holderType,
    shares: x.shares,
    lockInPeriod: x.isApproximate ? null : x.lockInPeriod,
    periodUnit: x.isApproximate ? null : x.periodUnit,
    publishedExpiryDate: x.publishedExpiryDate,
    ruleText: x.isApproximate
      ? `Source states an approximate period ("${x.snippet.slice(0, 120)}…") — not converted to an exact date`
      : null,
    evidence: {
      ...evidence,
      extractedText: x.snippet,
      parserConfidence: x.parserConfidence,
    },
  };
}
