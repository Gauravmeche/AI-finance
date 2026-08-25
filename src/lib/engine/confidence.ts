/**
 * Explainable confidence scoring.
 *
 * The score is a deterministic sum of named factors — every point is
 * accounted for and the breakdown is stored alongside the score so the UI
 * can show exactly why a date earned its confidence.
 */

export interface ConfidenceFactor {
  factor: string;
  points: number;
  maxPoints: number;
  met: boolean;
  detail: string;
}

export interface ConfidenceInput {
  hasPrimarySource: boolean;
  independentSourcesAgree: boolean;
  agreeingSourceCount: number;
  hasExplicitPublishedDate: boolean;
  calculationMatchesPublished: boolean | null; // null = no calculation possible
  freshestRetrievalAgeDays: number | null;
  minParserConfidence: number | null; // 0..1 across contributing records
  hasConflictingRecords: boolean;
}

export interface ConfidenceResult {
  score: number;
  band: "VERY_HIGH" | "HIGH" | "MEDIUM" | "LOW" | "NEEDS_REVIEW";
  factors: ConfidenceFactor[];
}

export function bandFor(score: number): ConfidenceResult["band"] {
  if (score >= 95) return "VERY_HIGH";
  if (score >= 85) return "HIGH";
  if (score >= 70) return "MEDIUM";
  if (score >= 50) return "LOW";
  return "NEEDS_REVIEW";
}

export const BAND_LABELS: Record<ConfidenceResult["band"], string> = {
  VERY_HIGH: "Very High",
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
  NEEDS_REVIEW: "Needs Review",
};

export function scoreConfidence(input: ConfidenceInput): ConfidenceResult {
  const factors: ConfidenceFactor[] = [];

  const add = (factor: string, met: boolean, maxPoints: number, detail: string, partial?: number) => {
    factors.push({ factor, met, maxPoints, points: met ? (partial ?? maxPoints) : 0, detail });
  };

  add(
    "primary_source",
    input.hasPrimarySource,
    30,
    input.hasPrimarySource
      ? "Primary/regulatory source (SEBI, exchange, prospectus or company filing) provided this date"
      : "No primary/regulatory source available for this date",
  );

  add(
    "independent_agreement",
    input.independentSourcesAgree,
    20,
    input.independentSourcesAgree
      ? `${input.agreeingSourceCount} independent sources report the same date`
      : "No independent cross-confirmation of this date",
  );

  add(
    "explicit_published_date",
    input.hasExplicitPublishedDate,
    15,
    input.hasExplicitPublishedDate
      ? "An explicit lock-in date was published by a source (not inferred)"
      : "No source publishes an explicit date; the date is calculated",
  );

  const calcMet = input.calculationMatchesPublished === true;
  add(
    "calculation_validates",
    calcMet,
    15,
    input.calculationMatchesPublished === true
      ? "Independent rule-based calculation reproduces the published date"
      : input.calculationMatchesPublished === false
        ? "Calculated date does NOT match the published date"
        : "No independent calculation available to validate the date",
  );

  const age = input.freshestRetrievalAgeDays;
  const fresh = age !== null && age <= 7;
  add(
    "source_freshness",
    fresh,
    10,
    age === null
      ? "No retrieval timestamp available"
      : fresh
        ? `Most recent source check was ${age} day(s) ago`
        : `Most recent source check was ${age} day(s) ago (stale)`,
    age !== null && age <= 3 ? 10 : 5,
  );

  const pc = input.minParserConfidence;
  const parseOk = pc !== null && pc >= 0.8;
  add(
    "parsing_confidence",
    parseOk,
    5,
    pc === null
      ? "No parser confidence recorded"
      : parseOk
        ? `All contributing extractions parsed with confidence ≥ 0.8 (min ${pc.toFixed(2)})`
        : `Lowest extraction parser confidence is ${pc.toFixed(2)}`,
  );

  add(
    "no_conflicts",
    !input.hasConflictingRecords,
    5,
    input.hasConflictingRecords
      ? "Conflicting dates exist across sources"
      : "No conflicting records across sources",
  );

  let score = factors.reduce((s, f) => s + f.points, 0);

  // A live disagreement between sources caps the score below the "High" band
  // regardless of other factors — a conflicted date is never high-confidence.
  if (input.hasConflictingRecords) score = Math.min(score, 60);
  // A calculation that contradicts the published date is a red flag.
  if (input.calculationMatchesPublished === false) score = Math.min(score, 55);

  return { score, band: bandFor(score), factors };
}
