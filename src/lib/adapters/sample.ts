/**
 * Demo source adapters. Three personas simulate an exchange, a prospectus
 * repository and a Tier-3 financial portal so the verification engine has
 * genuinely independent "sources" to cross-check. All data is fictional
 * and flagged as sample data end-to-end.
 */

import { buildSampleUniverse, type SamplePersona } from "./sample-data";
import type { AdapterContext, AdapterIpoResult, DiscoveredIpo, SourceAdapter } from "./types";
import type { SourceTier } from "../engine/verification";

const META: Record<SamplePersona, { name: string; tier: SourceTier }> = {
  demo_exchange: { name: "Demo Exchange Filings", tier: "TIER1_PRIMARY" },
  demo_prospectus: { name: "Demo Prospectus Repository", tier: "TIER1_PRIMARY" },
  demo_portal: { name: "Demo Financial Portal", tier: "TIER3_SECONDARY" },
};

export class SampleAdapter implements SourceAdapter {
  readonly key: SamplePersona;
  readonly name: string;
  readonly tier: SourceTier;

  constructor(persona: SamplePersona) {
    this.key = persona;
    this.name = META[persona].name;
    this.tier = META[persona].tier;
  }

  async discover(ctx: AdapterContext): Promise<DiscoveredIpo[]> {
    ctx.log(`${this.name}: discovering demo IPO universe`);
    return buildSampleUniverse(this.key).map((r) => r.ipo);
  }

  async fetchLockIns(_ipos: DiscoveredIpo[], ctx: AdapterContext): Promise<AdapterIpoResult[]> {
    const results = buildSampleUniverse(this.key);
    ctx.log(`${this.name}: ${results.length} IPOs with lock-in observations`);
    return results;
  }
}
