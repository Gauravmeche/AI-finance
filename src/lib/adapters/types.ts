/**
 * Source adapter contract.
 *
 * Every data source (NSE, BSE, SEBI, prospectus store, secondary portals,
 * demo fixtures…) implements this interface. The sync engine only speaks
 * this contract, so new sources can be added without touching core logic.
 */

import type { SourceTier } from "../engine/verification";

export type LockInCategory =
  | "ANCHOR_50PCT"
  | "ANCHOR_REMAINING"
  | "PROMOTER_MINIMUM_CONTRIBUTION"
  | "PROMOTER_EXCESS"
  | "PRE_IPO_SHAREHOLDER"
  | "EXISTING_SHAREHOLDER"
  | "OTHER";

export interface DiscoveredIpo {
  companyName: string;
  legalName?: string;
  ticker?: string;
  isin?: string;
  exchange?: string;
  ipoName: string;
  issueOpenDate?: string; // ISO
  issueCloseDate?: string;
  listingDate?: string;
  allotmentDate?: string;
  issuePrice?: number;
  listingPrice?: number;
  issueSizeCr?: number;
  status?: "UPCOMING" | "OPEN" | "LISTED" | "WITHDRAWN";
}

/** One source's statement about one lock-in event. */
export interface LockInObservation {
  category: LockInCategory;
  holderType: string;
  shares?: number | null;
  percentage?: number | null;
  lockInPeriod?: number | null;
  periodUnit?: "DAYS" | "MONTHS" | "YEARS" | null;
  startDate?: string | null;
  /** Explicit expiry date published by this source, if any. Never inferred here. */
  publishedExpiryDate?: string | null;
  /** The rule exactly as stated in the document, when available. */
  ruleText?: string | null;
  evidence: SourceEvidence;
}

export interface SourceEvidence {
  url: string;
  documentTitle?: string;
  publishedDate?: string | null;
  retrievedAt: string; // ISO timestamp
  extractedText?: string; // snippet backing the observation
  parserConfidence: number; // 0..1
  raw?: unknown; // relevant table row / structured payload
}

export interface AdapterIpoResult {
  ipo: DiscoveredIpo;
  observations: LockInObservation[];
}

export interface AdapterContext {
  /** Only fetch data newer than this when supported (incremental sync). */
  since?: string | null;
  log: (message: string) => void;
}

export interface SourceAdapter {
  /** Stable key referenced by the sources table (`adapterKey`). */
  readonly key: string;
  readonly name: string;
  readonly tier: SourceTier;

  /** Find IPOs this source knows about. */
  discover(ctx: AdapterContext): Promise<DiscoveredIpo[]>;

  /**
   * Fetch + parse + normalize + validate lock-in data for the given IPOs.
   * Implementations must throw SourceUnavailableError (not generic errors)
   * when the source blocks or cannot be reached, so the sync engine can
   * mark it unavailable and continue with other sources.
   */
  fetchLockIns(ipos: DiscoveredIpo[], ctx: AdapterContext): Promise<AdapterIpoResult[]>;
}

export class SourceUnavailableError extends Error {
  constructor(
    public readonly sourceName: string,
    message: string,
  ) {
    super(message);
    this.name = "SourceUnavailableError";
  }
}
