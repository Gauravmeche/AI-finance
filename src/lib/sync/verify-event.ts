/**
 * Re-verify a single lock-in event from its stored evidence: recompute the
 * rule-based calculation, cross-check all latest source records, apply any
 * active manual override, persist the outcome and append an audit row.
 * Used by the sync engine (phase 4) and by analyst actions (override /
 * verify) so both paths share identical logic.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { calculateExpiry, DEFAULT_LOCK_IN_RULES, type LockInRule } from "../engine/dates";
import { verifyLockInEvent, type EvidenceRecord, type VerificationOutcome } from "../engine/verification";

const toDate = (iso?: string | null) => (iso ? new Date(`${iso}T00:00:00Z`) : null);
const toIso = (d?: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export async function reverifyEvent(
  eventId: string,
  opts?: { fallbackStartDate?: string | null },
): Promise<VerificationOutcome | null> {
  const event = await prisma.lockInEvent.findUnique({
    where: { id: eventId },
    include: {
      ipo: true,
      overrides: { where: { isActive: true }, orderBy: { createdAt: "desc" }, take: 1 },
      sourceRecords: { include: { source: true }, orderBy: { retrievedAt: "desc" } },
    },
  });
  if (!event) return null;

  const startIso = toIso(event.startDate) ?? opts?.fallbackStartDate ?? toIso(event.ipo.listingDate);
  let calculated: string | null = null;
  let calcMethod: string | null = null;
  if (startIso) {
    let rule: LockInRule | null = null;
    if (event.lockInPeriod && event.periodUnit) {
      rule = {
        startDateField: "explicit",
        period: event.lockInPeriod,
        unit: event.periodUnit,
        ruleText: event.ruleText ?? "Period as stated by source",
      };
    } else if (DEFAULT_LOCK_IN_RULES[event.category]) {
      rule = DEFAULT_LOCK_IN_RULES[event.category];
    }
    if (rule) {
      const res = calculateExpiry(startIso, rule);
      calculated = res.calculatedExpiryDate;
      calcMethod = `${startIso} + ${res.lockInPeriod}`;
    }
  }

  // Only the most recent record per source participates in cross-checking.
  const latestPerSource = new Map<string, (typeof event.sourceRecords)[number]>();
  for (const r of event.sourceRecords) {
    if (!latestPerSource.has(r.sourceId)) latestPerSource.set(r.sourceId, r);
  }
  const evidence: EvidenceRecord[] = [...latestPerSource.values()].map((r) => ({
    sourceName: r.source.name,
    sourceTier: r.source.tier,
    sourcePriority: r.source.priority,
    url: r.url,
    extractedDate: r.extractedValue,
    parserConfidence: r.parserConfidence != null ? Number(r.parserConfidence) : null,
    retrievedAt: r.retrievedAt.toISOString(),
    publishedDate: toIso(r.publishedDate),
  }));

  const outcome = verifyLockInEvent({
    records: evidence,
    calculatedDate: calculated,
    activeOverrideDate: toIso(event.overrides[0]?.overrideDate),
  });

  const publishedExpiry =
    outcome.recommendedBasis === "published_primary" || outcome.recommendedBasis === "published_secondary"
      ? outcome.recommendedDate
      : (evidence.find((e) => e.extractedDate)?.extractedDate ?? null);

  await prisma.lockInEvent.update({
    where: { id: event.id },
    data: {
      calculatedExpiryDate: toDate(calculated),
      publishedExpiryDate: toDate(publishedExpiry),
      finalExpiryDate: toDate(outcome.recommendedDate),
      calculationMethod: calcMethod,
      verificationStatus: outcome.status,
      confidenceScore: outcome.confidence.score,
      confidenceFactors: outcome.confidence.factors as unknown as Prisma.InputJsonValue,
      notes: outcome.notes.join(" "),
    },
  });
  await prisma.verificationResult.create({
    data: {
      lockInEventId: event.id,
      status: outcome.status,
      recommendedDate: toDate(outcome.recommendedDate),
      confidenceScore: outcome.confidence.score,
      factors: outcome.confidence.factors as unknown as Prisma.InputJsonValue,
      comparison: {
        sourceDates: outcome.comparison.sourceDates,
        calculatedDate: outcome.comparison.calculatedDate,
        discrepancy: outcome.discrepancy,
      } as unknown as Prisma.InputJsonValue,
    },
  });
  return outcome;
}
