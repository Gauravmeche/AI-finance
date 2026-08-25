/**
 * Adapter registry: maps a Source row's `adapterKey` to an implementation.
 * Adding a new data source = implement SourceAdapter + register it here +
 * insert a row in the sources table (or via the admin Sources page).
 */

import { BSEAdapter } from "./bse";
import { ChittorgarhAdapter } from "./chittorgarh";
import { NSEAdapter } from "./nse";
import { SampleAdapter } from "./sample";
import type { SourceAdapter } from "./types";

const factories: Record<string, () => SourceAdapter> = {
  nse: () => new NSEAdapter(),
  bse: () => new BSEAdapter(),
  chittorgarh: () => new ChittorgarhAdapter(),
  demo_exchange: () => new SampleAdapter("demo_exchange"),
  demo_prospectus: () => new SampleAdapter("demo_prospectus"),
  demo_portal: () => new SampleAdapter("demo_portal"),
};

export function getAdapter(key: string): SourceAdapter | null {
  const factory = factories[key];
  return factory ? factory() : null;
}

export function registeredAdapterKeys(): string[] {
  return Object.keys(factories);
}
