/**
 * Serialization + shared query helpers for lock-in events.
 * Converts Prisma BigInt/Decimal/Date fields into JSON-safe values and
 * derives display fields (days remaining, staleness) in one place.
 */

import type { Prisma } from "@prisma/client";
import { daysUntil, todayIso } from "./engine/dates";
import { prisma } from "./db";

export type LockInEventWithRelations = Prisma.LockInEventGetPayload<{
  include: {
    ipo: { include: { company: true } };
    sourceRecords: { include: { source: true } };
    overrides: true;
  };
}>;

const isoDate = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

export function serializeEvent(e: LockInEventWithRelations) {
  const finalDate = isoDate(e.finalExpiryDate);
  const daysRemaining = finalDate ? daysUntil(finalDate) : null;
  const latestRetrieval = e.sourceRecords.length
    ? Math.max(...e.sourceRecords.map((r) => r.retrievedAt.getTime()))
    : null;
  const ageDays = latestRetrieval ? Math.floor((Date.now() - latestRetrieval) / 86_400_000) : null;

  return {
    id: e.id,
    ipoId: e.ipoId,
    company: e.ipo.company.name,
    ticker: e.ipo.company.ticker,
    isin: e.ipo.company.isin,
    exchange: e.ipo.company.exchange,
    ipoName: e.ipo.ipoName,
    isSampleData: e.ipo.isSampleData,
    listingDate: isoDate(e.ipo.listingDate),
    category: e.category,
    holderType: e.holderType,
    shares: e.shares != null ? Number(e.shares) : null,
    percentage: e.percentage != null ? Number(e.percentage) : null,
    lockInPeriod: e.lockInPeriod,
    periodUnit: e.periodUnit,
    startDate: isoDate(e.startDate),
    calculatedExpiryDate: isoDate(e.calculatedExpiryDate),
    publishedExpiryDate: isoDate(e.publishedExpiryDate),
    finalExpiryDate: finalDate,
    calculationMethod: e.calculationMethod,
    ruleText: e.ruleText,
    verificationStatus: e.verificationStatus,
    confidenceScore: e.confidenceScore,
    confidenceFactors: e.confidenceFactors,
    notes: e.notes,
    daysRemaining,
    expired: daysRemaining !== null && daysRemaining < 0,
    dataAgeDays: ageDays,
    freshness: ageDays === null ? "unknown" : ageDays < 3 ? "fresh" : ageDays <= 7 ? "aging" : "stale",
    lastVerifiedAt: e.updatedAt.toISOString(),
    activeOverride: e.overrides.find((o) => o.isActive)
      ? {
          date: isoDate(e.overrides.find((o) => o.isActive)!.overrideDate),
          analystName: e.overrides.find((o) => o.isActive)!.analystName,
          reason: e.overrides.find((o) => o.isActive)!.reason,
        }
      : null,
    sources: e.sourceRecords.map((r) => ({
      id: r.id,
      sourceName: r.source.name,
      tier: r.source.tier,
      priority: r.source.priority,
      url: r.url,
      documentTitle: r.documentTitle,
      publishedDate: isoDate(r.publishedDate),
      retrievedAt: r.retrievedAt.toISOString(),
      extractedValue: r.extractedValue,
      extractedText: r.extractedText,
      parserConfidence: r.parserConfidence != null ? Number(r.parserConfidence) : null,
    })),
  };
}

export type SerializedEvent = ReturnType<typeof serializeEvent>;

export interface EventFilters {
  q?: string;
  exchange?: string;
  category?: string;
  status?: string;
  minConfidence?: number;
  maxConfidence?: number;
  from?: string;
  to?: string;
  window?: "upcoming" | "expired" | "all";
  needsReview?: boolean;
  sort?: string;
  order?: "asc" | "desc";
}

export function parseEventFilters(searchParams: URLSearchParams): EventFilters {
  return {
    q: searchParams.get("q") ?? undefined,
    exchange: searchParams.get("exchange") ?? undefined,
    category: searchParams.get("category") ?? undefined,
    status: searchParams.get("status") ?? undefined,
    minConfidence: searchParams.get("minConfidence") ? Number(searchParams.get("minConfidence")) : undefined,
    maxConfidence: searchParams.get("maxConfidence") ? Number(searchParams.get("maxConfidence")) : undefined,
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
    window: (searchParams.get("window") as EventFilters["window"]) ?? undefined,
    needsReview: searchParams.get("needsReview") === "true",
    sort: searchParams.get("sort") ?? undefined,
    order: (searchParams.get("order") as "asc" | "desc") ?? undefined,
  };
}

const REVIEW_STATUSES = ["DATE_DISCREPANCY", "NEEDS_REVIEW", "SOURCE_UNAVAILABLE"] as const;

export async function queryEvents(filters: EventFilters): Promise<SerializedEvent[]> {
  const where: Prisma.LockInEventWhereInput = {};
  const today = new Date(`${todayIso()}T00:00:00Z`);

  const ipoWhere: Prisma.IpoWhereInput = {};
  if (filters.q) {
    ipoWhere.OR = [
      { company: { name: { contains: filters.q, mode: "insensitive" } } },
      { company: { ticker: { contains: filters.q, mode: "insensitive" } } },
      { company: { isin: { contains: filters.q, mode: "insensitive" } } },
      { ipoName: { contains: filters.q, mode: "insensitive" } },
    ];
  }
  if (filters.exchange) {
    ipoWhere.company = { exchange: { contains: filters.exchange, mode: "insensitive" } };
  }
  if (Object.keys(ipoWhere).length) where.ipo = ipoWhere;
  if (filters.category) where.category = filters.category as Prisma.LockInEventWhereInput["category"];
  if (filters.status) where.verificationStatus = filters.status as Prisma.LockInEventWhereInput["verificationStatus"];
  if (filters.needsReview) where.verificationStatus = { in: [...REVIEW_STATUSES] };
  if (filters.minConfidence !== undefined || filters.maxConfidence !== undefined) {
    where.confidenceScore = {
      ...(filters.minConfidence !== undefined ? { gte: filters.minConfidence } : {}),
      ...(filters.maxConfidence !== undefined ? { lte: filters.maxConfidence } : {}),
    };
  }
  const dateFilter: Prisma.DateTimeNullableFilter = {};
  if (filters.window === "upcoming") dateFilter.gte = today;
  if (filters.window === "expired") dateFilter.lt = today;
  if (filters.from) dateFilter.gte = new Date(`${filters.from}T00:00:00Z`);
  if (filters.to) dateFilter.lte = new Date(`${filters.to}T00:00:00Z`);
  if (Object.keys(dateFilter).length) where.finalExpiryDate = dateFilter;

  const events = await prisma.lockInEvent.findMany({
    where,
    include: {
      ipo: { include: { company: true } },
      sourceRecords: { include: { source: true }, orderBy: { retrievedAt: "desc" } },
      overrides: true,
    },
  });

  const serialized = events.map(serializeEvent);

  const sortKey = filters.sort ?? "finalExpiryDate";
  const dir = filters.order === "desc" ? -1 : 1;
  serialized.sort((a, b) => {
    const va = sortValue(a, sortKey);
    const vb = sortValue(b, sortKey);
    if (va === null && vb === null) return 0;
    if (va === null) return 1; // nulls last regardless of direction
    if (vb === null) return -1;
    return va < vb ? -dir : va > vb ? dir : 0;
  });
  return serialized;
}

function sortValue(e: SerializedEvent, key: string): string | number | null {
  switch (key) {
    case "company":
      return e.company.toLowerCase();
    case "ipo":
      return e.ipoName.toLowerCase();
    case "confidence":
      return e.confidenceScore;
    case "shares":
      return e.shares;
    case "status":
      return e.verificationStatus;
    case "daysRemaining":
      return e.daysRemaining;
    case "finalExpiryDate":
    default:
      return e.finalExpiryDate;
  }
}
