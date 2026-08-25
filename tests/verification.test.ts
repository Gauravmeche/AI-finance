import { describe, expect, it } from "vitest";
import { verifyLockInEvent, type EvidenceRecord } from "../src/lib/engine/verification";

// Fictional fixture from the spec: Example Technologies Ltd., listed
// 10 Jun 2026, 90-day lock-in → calculated expiry 08 Sep 2026.
const CALCULATED = "2026-09-08";
const NOW = "2026-08-25";

function record(partial: Partial<EvidenceRecord>): EvidenceRecord {
  return {
    sourceName: "Source A",
    sourceTier: "TIER1_PRIMARY",
    sourcePriority: 10,
    url: "https://example.org/a",
    extractedDate: CALCULATED,
    parserConfidence: 0.9,
    retrievedAt: `${NOW}T10:00:00Z`,
    publishedDate: "2026-06-11",
    ...partial,
  };
}

describe("cross-checking / verification engine", () => {
  it("VERIFIED with Very High confidence when primary + secondary agree and calculation matches", () => {
    const outcome = verifyLockInEvent({
      records: [
        record({ sourceName: "Source A (exchange)" }),
        record({ sourceName: "Source B (portal)", sourceTier: "TIER3_SECONDARY", sourcePriority: 60, url: "https://example.org/b" }),
      ],
      calculatedDate: CALCULATED,
      now: NOW,
    });
    expect(outcome.status).toBe("VERIFIED");
    expect(outcome.recommendedDate).toBe(CALCULATED);
    expect(outcome.confidence.band).toBe("VERY_HIGH");
    expect(outcome.discrepancy).toBeNull();
  });

  it("DATE_DISCREPANCY when sources disagree — never hidden, authority recommended", () => {
    const outcome = verifyLockInEvent({
      records: [
        record({ sourceName: "Source A (exchange)", extractedDate: "2026-09-08" }),
        record({ sourceName: "Source B (portal)", sourceTier: "TIER3_SECONDARY", sourcePriority: 60, extractedDate: "2026-09-09" }),
      ],
      calculatedDate: CALCULATED,
      now: NOW,
    });
    expect(outcome.status).toBe("DATE_DISCREPANCY");
    expect(outcome.discrepancy).not.toBeNull();
    expect(outcome.discrepancy!.authoritativeSource).toBe("Source A (exchange)");
    expect(outcome.discrepancy!.authoritativeDate).toBe("2026-09-08");
    expect(outcome.discrepancy!.dates).toHaveLength(2);
    expect(outcome.discrepancy!.explanation).toContain("anchor dates");
    // A conflicted date is never high-confidence.
    expect(outcome.confidence.score).toBeLessThanOrEqual(60);
  });

  it("PRIMARY_SOURCE_ONLY with a single tier-1 source", () => {
    const outcome = verifyLockInEvent({ records: [record({})], calculatedDate: CALCULATED, now: NOW });
    expect(outcome.status).toBe("PRIMARY_SOURCE_ONLY");
  });

  it("SECONDARY_SOURCE_ONLY with a single tier-3 source", () => {
    const outcome = verifyLockInEvent({
      records: [record({ sourceTier: "TIER3_SECONDARY", sourcePriority: 60 })],
      calculatedDate: null,
      now: NOW,
    });
    expect(outcome.status).toBe("SECONDARY_SOURCE_ONLY");
  });

  it("CROSS_CHECKED when two secondary sources agree without a primary", () => {
    const outcome = verifyLockInEvent({
      records: [
        record({ sourceTier: "TIER3_SECONDARY", sourcePriority: 60 }),
        record({ sourceName: "Source C", sourceTier: "TIER3_SECONDARY", sourcePriority: 61, url: "https://example.org/c" }),
      ],
      calculatedDate: null,
      now: NOW,
    });
    expect(outcome.status).toBe("CROSS_CHECKED");
  });

  it("CALCULATION_REQUIRED when no source publishes a date but the rule allows calculation", () => {
    const outcome = verifyLockInEvent({
      records: [record({ extractedDate: null })],
      calculatedDate: CALCULATED,
      now: NOW,
    });
    expect(outcome.status).toBe("CALCULATION_REQUIRED");
    expect(outcome.recommendedDate).toBe(CALCULATED);
    expect(outcome.recommendedBasis).toBe("calculated");
  });

  it("SOURCE_UNAVAILABLE when nothing was retrieved and nothing can be calculated — never guesses", () => {
    const outcome = verifyLockInEvent({ records: [], calculatedDate: null, now: NOW });
    expect(outcome.status).toBe("SOURCE_UNAVAILABLE");
    expect(outcome.recommendedDate).toBeNull();
  });

  it("NEEDS_REVIEW when only low-confidence extractions exist — the garbled date is discarded, not trusted", () => {
    const outcome = verifyLockInEvent({
      records: [record({ parserConfidence: 0.3 })],
      calculatedDate: null,
      now: NOW,
    });
    expect(outcome.status).toBe("NEEDS_REVIEW");
    expect(outcome.recommendedDate).toBeNull();
  });

  it("flags for review when calculated date contradicts the published date", () => {
    const outcome = verifyLockInEvent({
      records: [record({ extractedDate: "2026-09-10" })],
      calculatedDate: CALCULATED,
      now: NOW,
    });
    expect(outcome.status).toBe("NEEDS_REVIEW");
    // Published date is still recommended (never silently replaced by the calculation)
    expect(outcome.recommendedDate).toBe("2026-09-10");
    expect(outcome.calculationMatchesPublished).toBe(false);
    expect(outcome.confidence.score).toBeLessThanOrEqual(55);
  });

  it("MANUALLY_VERIFIED when an analyst override is active; final = override date", () => {
    const outcome = verifyLockInEvent({
      records: [
        record({ extractedDate: "2026-09-08" }),
        record({ sourceName: "B", sourceTier: "TIER3_SECONDARY", sourcePriority: 60, extractedDate: "2026-09-09" }),
      ],
      calculatedDate: CALCULATED,
      activeOverrideDate: "2026-09-09",
      now: NOW,
    });
    expect(outcome.status).toBe("MANUALLY_VERIFIED");
    expect(outcome.recommendedDate).toBe("2026-09-09");
    expect(outcome.recommendedBasis).toBe("override");
    // Underlying comparison data is still preserved for the audit trail.
    expect(outcome.comparison.sourceDates).toHaveLength(2);
  });

  it("ignores invalid extracted dates (missing/invalid date validation)", () => {
    const outcome = verifyLockInEvent({
      records: [record({ extractedDate: "2026-02-30" }), record({ sourceName: "B", extractedDate: "garbage" })],
      calculatedDate: CALCULATED,
      now: NOW,
    });
    expect(outcome.status).toBe("CALCULATION_REQUIRED");
  });

  it("confidence factors are explainable and sum to the score", () => {
    const outcome = verifyLockInEvent({
      records: [record({})],
      calculatedDate: CALCULATED,
      now: NOW,
    });
    const sum = outcome.confidence.factors.reduce((s, f) => s + f.points, 0);
    expect(sum).toBe(outcome.confidence.score);
    for (const f of outcome.confidence.factors) expect(f.detail.length).toBeGreaterThan(10);
  });
});
