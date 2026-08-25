/**
 * Cross-checking / verification engine.
 *
 * Compares the dates reported by every source for a lock-in event against
 * each other and against the rule-based calculation, assigns a verification
 * status, recommends a date (never inventing one), and produces an
 * explainable confidence score.
 */

import { scoreConfidence, type ConfidenceResult } from "./confidence";
import { daysUntil, isValidIsoDate } from "./dates";

export type VerificationStatus =
  | "VERIFIED"
  | "CROSS_CHECKED"
  | "PRIMARY_SOURCE_ONLY"
  | "SECONDARY_SOURCE_ONLY"
  | "DATE_DISCREPANCY"
  | "CALCULATION_REQUIRED"
  | "NEEDS_REVIEW"
  | "SOURCE_UNAVAILABLE"
  | "MANUALLY_VERIFIED";

export type SourceTier = "TIER1_PRIMARY" | "TIER2_RELIABLE" | "TIER3_SECONDARY";

export interface EvidenceRecord {
  sourceName: string;
  sourceTier: SourceTier;
  /** Lower number = higher authority. Configurable per source. */
  sourcePriority: number;
  url: string;
  extractedDate: string | null; // ISO yyyy-mm-dd, exactly as extracted
  parserConfidence: number | null; // 0..1
  retrievedAt: string; // ISO timestamp
  publishedDate: string | null;
}

export interface SourceDateEntry {
  sourceName: string;
  sourceTier: SourceTier;
  sourcePriority: number;
  url: string;
  date: string;
  parserConfidence: number | null;
}

export interface DiscrepancyDetail {
  dates: { date: string; sources: SourceDateEntry[] }[];
  authoritativeSource: string;
  authoritativeDate: string;
  explanation: string;
}

export interface VerificationOutcome {
  status: VerificationStatus;
  /** The date the engine recommends displaying. null = "Date unavailable / Needs Review". */
  recommendedDate: string | null;
  /** Where the recommended date came from. */
  recommendedBasis: "published_primary" | "published_secondary" | "calculated" | "override" | "none";
  confidence: ConfidenceResult;
  discrepancy: DiscrepancyDetail | null;
  calculationMatchesPublished: boolean | null;
  comparison: {
    sourceDates: SourceDateEntry[];
    calculatedDate: string | null;
  };
  notes: string[];
}

const MIN_PARSE_CONFIDENCE = 0.5;

export function verifyLockInEvent(params: {
  records: EvidenceRecord[];
  calculatedDate: string | null;
  activeOverrideDate?: string | null;
  now?: string;
}): VerificationOutcome {
  const { records, calculatedDate, activeOverrideDate, now } = params;
  const notes: string[] = [];

  // ---- Gather usable published dates ------------------------------------
  const usable: SourceDateEntry[] = records
    .filter((r) => r.extractedDate && isValidIsoDate(r.extractedDate))
    .filter((r) => {
      const ok = r.parserConfidence === null || r.parserConfidence >= MIN_PARSE_CONFIDENCE;
      if (!ok) notes.push(`${r.sourceName}: extraction discarded (parser confidence ${r.parserConfidence}) — needs review`);
      return ok;
    })
    .map((r) => ({
      sourceName: r.sourceName,
      sourceTier: r.sourceTier,
      sourcePriority: r.sourcePriority,
      url: r.url,
      date: r.extractedDate as string,
      parserConfidence: r.parserConfidence,
    }))
    .sort((a, b) => a.sourcePriority - b.sourcePriority);

  const distinctDates = [...new Set(usable.map((u) => u.date))];
  const primary = usable.filter((u) => u.sourceTier === "TIER1_PRIMARY");
  const nonPrimary = usable.filter((u) => u.sourceTier !== "TIER1_PRIMARY");

  const freshestAge = records.length
    ? Math.min(
        ...records.map((r) => Math.max(0, -daysUntil(r.retrievedAt.slice(0, 10), now))),
      )
    : null;
  const minParse = usable.length
    ? Math.min(...usable.map((u) => u.parserConfidence ?? 1))
    : null;

  const conflict = distinctDates.length > 1;

  // ---- Determine authoritative published date ---------------------------
  const authoritative = usable[0] ?? null; // lowest priority number = highest authority
  const calculationMatchesPublished =
    calculatedDate && authoritative ? calculatedDate === authoritative.date : null;

  // ---- Status decision ---------------------------------------------------
  let status: VerificationStatus;
  let recommendedDate: string | null = null;
  let recommendedBasis: VerificationOutcome["recommendedBasis"] = "none";
  let discrepancy: DiscrepancyDetail | null = null;

  if (activeOverrideDate) {
    status = "MANUALLY_VERIFIED";
    recommendedDate = activeOverrideDate;
    recommendedBasis = "override";
    notes.push("An analyst override is active; underlying source data is preserved unchanged.");
  } else if (conflict) {
    status = "DATE_DISCREPANCY";
    recommendedDate = authoritative.date;
    recommendedBasis = authoritative.sourceTier === "TIER1_PRIMARY" ? "published_primary" : "published_secondary";
    discrepancy = buildDiscrepancy(usable, distinctDates);
    notes.push("Sources disagree on the expiry date. The discrepancy is surfaced, not hidden.");
  } else if (usable.length === 0) {
    if (calculatedDate) {
      status = "CALCULATION_REQUIRED";
      recommendedDate = calculatedDate;
      recommendedBasis = "calculated";
      notes.push("No source publishes an explicit date; showing the rule-based calculated date, clearly identified as calculated.");
    } else if (records.length === 0) {
      status = "SOURCE_UNAVAILABLE";
      notes.push("No source could be retrieved and no calculation is possible. Date unavailable — the system never guesses.");
    } else {
      status = "NEEDS_REVIEW";
      notes.push("Sources were retrieved but no reliable date could be extracted. Date unavailable — the system never guesses.");
    }
  } else {
    // All published dates agree.
    const agreed = usable[0].date;
    recommendedDate = agreed;
    if (calculatedDate && calculatedDate !== agreed) {
      status = "NEEDS_REVIEW";
      recommendedBasis = primary.length ? "published_primary" : "published_secondary";
      notes.push(
        `Calculated date (${calculatedDate}) differs from the published date (${agreed}). Flagged for analyst review.`,
      );
    } else if (primary.length > 0 && nonPrimary.length > 0) {
      status = "VERIFIED";
      recommendedBasis = "published_primary";
    } else if (primary.length === 0 && usable.length >= 2) {
      status = "CROSS_CHECKED";
      recommendedBasis = "published_secondary";
    } else if (primary.length > 0) {
      status = "PRIMARY_SOURCE_ONLY";
      recommendedBasis = "published_primary";
    } else {
      status = "SECONDARY_SOURCE_ONLY";
      recommendedBasis = "published_secondary";
    }
  }

  const confidence = scoreConfidence({
    hasPrimarySource: primary.length > 0,
    independentSourcesAgree: !conflict && usable.length >= 2,
    agreeingSourceCount: conflict ? 0 : usable.length,
    hasExplicitPublishedDate: usable.length > 0,
    calculationMatchesPublished,
    freshestRetrievalAgeDays: freshestAge,
    minParserConfidence: minParse,
    hasConflictingRecords: conflict,
  });

  return {
    status,
    recommendedDate,
    recommendedBasis,
    confidence,
    discrepancy,
    calculationMatchesPublished,
    comparison: { sourceDates: usable, calculatedDate },
    notes,
  };
}

function buildDiscrepancy(usable: SourceDateEntry[], distinctDates: string[]): DiscrepancyDetail {
  const authoritative = usable[0];
  const grouped = distinctDates.map((date) => ({
    date,
    sources: usable.filter((u) => u.date === date),
  }));

  const reasons: string[] = [];
  const dayGaps = distinctDates
    .slice(1)
    .map((d) => Math.abs(daysUntil(d, distinctDates[0])));
  if (dayGaps.every((g) => g <= 3)) {
    reasons.push(
      "Dates differ by a few days — sources may count the lock-in period from different anchor dates (allotment vs listing) or apply inclusive vs exclusive day counting.",
    );
  } else {
    reasons.push(
      "Dates differ materially — one source may reference a different lock-in tranche or category, or contain an error.",
    );
  }
  reasons.push(
    `${authoritative.sourceName} has the highest configured authority (${authoritative.sourceTier}, priority ${authoritative.sourcePriority}); its date is recommended pending analyst review.`,
  );

  return {
    dates: grouped,
    authoritativeSource: authoritative.sourceName,
    authoritativeDate: authoritative.date,
    explanation: reasons.join(" "),
  };
}
