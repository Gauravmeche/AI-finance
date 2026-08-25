/**
 * Sync engine.
 *
 * startSync() creates a sync_runs row and kicks off the pipeline in the
 * background — the HTTP request returns immediately and the UI polls
 * /api/sync/status. One sync runs at a time. A failed source never stops
 * the run: it is recorded in sync_errors and the engine moves on.
 *
 * The same runSyncPipeline() entry point serves manual, scheduled and
 * API-triggered syncs, so a cron/queue can be attached without redesign.
 */

import { Prisma, type SyncTrigger } from "@prisma/client";
import { getAdapter } from "../adapters/registry";
import {
  SourceUnavailableError,
  type AdapterIpoResult,
  type DiscoveredIpo,
  type LockInObservation,
} from "../adapters/types";
import { isValidIsoDate } from "../engine/dates";
import { matchCompanies } from "../engine/normalize";
import { prisma } from "../db";
import { reverifyEvent } from "./verify-event";

interface ProgressStep {
  source: string;
  status: "pending" | "running" | "ok" | "failed" | "unavailable";
  message?: string;
}

export interface SyncProgress {
  steps: ProgressStep[];
  iposProcessed: number;
  eventsUpdated: number;
  newIpos: number;
  discrepancies: number;
  phase: string;
}

let activeRunId: string | null = null;

export function isSyncRunning(): boolean {
  return activeRunId !== null;
}

export async function startSync(trigger: SyncTrigger, triggeredBy?: string): Promise<{ runId: string } | { error: string }> {
  if (activeRunId) return { error: "A sync is already running" };
  const run = await prisma.syncRun.create({
    data: { trigger, triggeredBy, progress: { steps: [], phase: "starting" } as unknown as Prisma.InputJsonValue },
  });
  activeRunId = run.id;
  // Fire and forget — deliberately not awaited by the API route.
  void runSyncPipeline(run.id)
    .catch(async (err) => {
      await prisma.syncRun.update({
        where: { id: run.id },
        data: { status: "FAILED", completedAt: new Date() },
      });
      await prisma.syncError.create({
        data: {
          syncRunId: run.id,
          sourceName: "engine",
          errorType: "fatal",
          errorMessage: err instanceof Error ? err.message : String(err),
        },
      });
    })
    .finally(() => {
      activeRunId = null;
    });
  return { runId: run.id };
}

async function saveProgress(runId: string, progress: SyncProgress, counters?: Partial<{
  iposProcessed: number; newIposFound: number; discrepanciesDetected: number;
  recordsCreated: number; recordsUpdated: number; recordsFound: number; recordsFailed: number;
  sourcesChecked: number; sourcesFailed: number;
}>) {
  await prisma.syncRun.update({
    where: { id: runId },
    data: { progress: progress as unknown as Prisma.InputJsonValue, ...counters },
  });
}

const toDate = (iso?: string | null) => (iso && isValidIsoDate(iso) ? new Date(`${iso}T00:00:00Z`) : null);
const toIso = (d?: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export async function runSyncPipeline(runId: string): Promise<void> {
  const sources = await prisma.source.findMany({ where: { isActive: true }, orderBy: { priority: "asc" } });
  const progress: SyncProgress = {
    steps: sources.map((s) => ({ source: s.name, status: "pending" })),
    iposProcessed: 0,
    eventsUpdated: 0,
    newIpos: 0,
    discrepancies: 0,
    phase: "discovering",
  };
  let recordsCreated = 0;
  let recordsFound = 0;
  let sourcesFailed = 0;
  let sourcesChecked = 0;

  const log = (m: string) => console.log(`[sync ${runId}] ${m}`);

  // ---- Phase 1: run every active source's adapter -------------------------
  const perSourceResults = new Map<string, AdapterIpoResult[]>(); // sourceId -> results
  for (const [i, source] of sources.entries()) {
    const step = progress.steps[i];
    step.status = "running";
    await saveProgress(runId, progress);

    const adapter = getAdapter(source.adapterKey);
    if (!adapter) {
      step.status = "failed";
      step.message = `No adapter registered for key "${source.adapterKey}"`;
      sourcesFailed++;
      await prisma.syncError.create({
        data: { syncRunId: runId, sourceName: source.name, errorType: "config", errorMessage: step.message },
      });
      continue;
    }

    try {
      const ctx = { log, since: toIso(source.lastSuccessAt) };
      const discovered = await adapter.discover(ctx);
      const results = await adapter.fetchLockIns(discovered, ctx);
      perSourceResults.set(source.id, results);
      recordsFound += results.reduce((n, r) => n + r.observations.length, 0);
      sourcesChecked++;
      step.status = "ok";
      step.message = `${discovered.length} IPOs, ${results.length} with lock-in data`;
      await prisma.source.update({
        where: { id: source.id },
        data: { lastSuccessAt: new Date(), lastError: null },
      });
    } catch (err) {
      sourcesFailed++;
      const unavailable = err instanceof SourceUnavailableError;
      step.status = unavailable ? "unavailable" : "failed";
      step.message = err instanceof Error ? err.message : String(err);
      await prisma.source.update({
        where: { id: source.id },
        data: { lastErrorAt: new Date(), lastError: step.message },
      });
      await prisma.syncError.create({
        data: {
          syncRunId: runId,
          sourceName: source.name,
          errorType: unavailable ? "blocked" : "network",
          errorMessage: step.message,
        },
      });
    }
    await saveProgress(runId, progress, { sourcesChecked, sourcesFailed, recordsFound });
  }

  // ---- Phase 2: upsert companies / IPOs (identifier-first dedup) ----------
  progress.phase = "normalizing";
  await saveProgress(runId, progress);

  const existingCompanies = await prisma.company.findMany({ include: { ipos: true } });
  const ipoIdByKey = new Map<string, string>(); // dedup key -> ipo.id
  let newIpos = 0;

  const dedupKey = (d: DiscoveredIpo) =>
    d.isin?.toUpperCase() ?? `${d.ticker?.toUpperCase() ?? ""}|${d.companyName.toLowerCase()}`;

  for (const [sourceId, results] of perSourceResults) {
    const source = sources.find((s) => s.id === sourceId)!;
    const isSample = source.adapterKey.startsWith("demo_");
    for (const { ipo } of results) {
      const key = dedupKey(ipo);
      if (ipoIdByKey.has(key)) continue;

      // Match against existing DB companies using strong identifiers first.
      let company = existingCompanies.find(
        (c) =>
          matchCompanies(
            { name: c.name, isin: c.isin, ticker: c.ticker, listingDate: toIso(c.ipos[0]?.listingDate) },
            { name: ipo.companyName, isin: ipo.isin, ticker: ipo.ticker, listingDate: ipo.listingDate },
          ) !== "none",
      );
      if (!company) {
        const created = await prisma.company.create({
          data: {
            name: ipo.companyName,
            legalName: ipo.legalName ?? ipo.companyName,
            ticker: ipo.ticker,
            isin: ipo.isin,
            exchange: ipo.exchange,
          },
        });
        company = { ...created, ipos: [] };
        existingCompanies.push(company);
      }

      let dbIpo = await prisma.ipo.findFirst({ where: { companyId: company.id } });
      if (!dbIpo) {
        dbIpo = await prisma.ipo.create({
          data: {
            companyId: company.id,
            ipoName: ipo.ipoName,
            issueOpenDate: toDate(ipo.issueOpenDate),
            issueCloseDate: toDate(ipo.issueCloseDate),
            listingDate: toDate(ipo.listingDate),
            issuePrice: ipo.issuePrice,
            listingPrice: ipo.listingPrice,
            issueSizeCr: ipo.issueSizeCr,
            status: ipo.status ?? "LISTED",
            isSampleData: isSample,
          },
        });
        newIpos++;
      }
      ipoIdByKey.set(key, dbIpo.id);
    }
  }
  progress.newIpos = newIpos;

  // ---- Phase 3: store source records per lock-in event --------------------
  progress.phase = "storing evidence";
  await saveProgress(runId, progress, { newIposFound: newIpos });

  // Observations carry allotment/listing context for the verification phase.
  const touchedEventIds = new Set<string>();
  const obsContext = new Map<string, { allotmentDate?: string | null; listingDate?: string | null }>();

  for (const [sourceId, results] of perSourceResults) {
    for (const { ipo, observations } of results) {
      const ipoId = ipoIdByKey.get(dedupKey(ipo));
      if (!ipoId) continue;
      obsContext.set(ipoId, { allotmentDate: ipo.allotmentDate, listingDate: ipo.listingDate });

      for (const obs of observations) {
        const event = await upsertEvent(ipoId, obs);
        touchedEventIds.add(event.id);

        // One record per (event, source) per run-cycle: replace stale record
        // from the same source rather than duplicating on every sync.
        const existing = await prisma.sourceRecord.findFirst({
          where: { lockInEventId: event.id, sourceId },
          orderBy: { retrievedAt: "desc" },
        });
        const data = {
          lockInEventId: event.id,
          ipoId,
          sourceId,
          url: obs.evidence.url,
          documentTitle: obs.evidence.documentTitle,
          publishedDate: toDate(obs.evidence.publishedDate),
          retrievedAt: new Date(obs.evidence.retrievedAt),
          extractedValue: obs.publishedExpiryDate,
          extractedText: obs.evidence.extractedText,
          parserConfidence: obs.evidence.parserConfidence,
          rawEvidence: (obs.evidence.raw ?? undefined) as Prisma.InputJsonValue | undefined,
        };
        if (existing && existing.extractedValue === obs.publishedExpiryDate) {
          await prisma.sourceRecord.update({ where: { id: existing.id }, data: { retrievedAt: data.retrievedAt } });
        } else {
          await prisma.sourceRecord.create({ data });
          recordsCreated++;
        }
      }
    }
  }

  // ---- Phase 4: calculate + cross-check every touched event ---------------
  progress.phase = "verifying";
  await saveProgress(runId, progress, { recordsCreated });

  let eventsUpdated = 0;
  let discrepancies = 0;

  for (const eventId of touchedEventIds) {
    const event = await prisma.lockInEvent.findUnique({ where: { id: eventId }, select: { ipoId: true } });
    const ctxDates = event ? (obsContext.get(event.ipoId) ?? {}) : {};
    const outcome = await reverifyEvent(eventId, {
      fallbackStartDate: ctxDates.allotmentDate ?? ctxDates.listingDate ?? null,
    });
    if (!outcome) continue;
    if (outcome.status === "DATE_DISCREPANCY") discrepancies++;
    eventsUpdated++;
    progress.eventsUpdated = eventsUpdated;
    progress.discrepancies = discrepancies;
  }

  progress.iposProcessed = ipoIdByKey.size;
  progress.phase = "completed";
  const hasErrors = sourcesFailed > 0;
  await prisma.syncRun.update({
    where: { id: runId },
    data: {
      status: hasErrors ? "COMPLETED_WITH_ERRORS" : "COMPLETED",
      completedAt: new Date(),
      iposProcessed: ipoIdByKey.size,
      newIposFound: newIpos,
      recordsUpdated: eventsUpdated,
      recordsCreated,
      recordsFound,
      discrepanciesDetected: discrepancies,
      sourcesChecked,
      sourcesFailed,
      progress: progress as unknown as Prisma.InputJsonValue,
    },
  });
}

async function upsertEvent(ipoId: string, obs: LockInObservation) {
  const existing = await prisma.lockInEvent.findFirst({
    where: { ipoId, category: obs.category },
  });
  if (existing) {
    // Enrich missing fields; never clobber analyst-visible data with nulls.
    return prisma.lockInEvent.update({
      where: { id: existing.id },
      data: {
        holderType: existing.holderType || obs.holderType,
        shares: existing.shares ?? (obs.shares != null ? BigInt(obs.shares) : null),
        percentage: existing.percentage ?? obs.percentage,
        lockInPeriod: existing.lockInPeriod ?? obs.lockInPeriod,
        periodUnit: existing.periodUnit ?? obs.periodUnit,
        startDate: existing.startDate ?? (obs.startDate ? new Date(`${obs.startDate}T00:00:00Z`) : null),
        ruleText: existing.ruleText ?? obs.ruleText,
      },
    });
  }
  return prisma.lockInEvent.create({
    data: {
      ipoId,
      category: obs.category,
      holderType: obs.holderType,
      shares: obs.shares != null ? BigInt(obs.shares) : null,
      percentage: obs.percentage,
      lockInPeriod: obs.lockInPeriod,
      periodUnit: obs.periodUnit,
      startDate: obs.startDate ? new Date(`${obs.startDate}T00:00:00Z`) : null,
      ruleText: obs.ruleText,
    },
  });
}
