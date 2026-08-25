/**
 * Responsible HTTP client for source adapters.
 *
 * - Respects robots.txt (cached per host)
 * - Per-host minimum request spacing
 * - Timeouts + retries with exponential backoff (network errors / 5xx only)
 * - In-memory response cache to avoid re-downloading unchanged documents
 * - Honest User-Agent
 * - Never attempts to bypass CAPTCHAs, auth walls, or anti-bot systems:
 *   403/401/429 responses raise SourceUnavailableError immediately.
 */

import { SourceUnavailableError } from "./types";

const USER_AGENT =
  "IPOLockinTracker/1.0 (research tool; respects robots.txt; contact: admin@example.com)";

const DEFAULT_TIMEOUT_MS = 20_000;
const MIN_HOST_SPACING_MS = 1_500;
const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_RETRIES = 3;

interface CacheEntry {
  body: string;
  fetchedAt: number;
}

const responseCache = new Map<string, CacheEntry>();
const robotsCache = new Map<string, { disallows: string[]; fetchedAt: number }>();
const lastRequestAt = new Map<string, number>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function throttleHost(host: string) {
  const last = lastRequestAt.get(host) ?? 0;
  const wait = last + MIN_HOST_SPACING_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt.set(host, Date.now());
}

async function getRobots(origin: string): Promise<string[]> {
  const cached = robotsCache.get(origin);
  if (cached && Date.now() - cached.fetchedAt < 24 * 60 * 60 * 1000) return cached.disallows;
  let disallows: string[] = [];
  try {
    const res = await fetch(`${origin}/robots.txt`, {
      headers: { "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      const text = await res.text();
      let applies = false;
      for (const line of text.split("\n")) {
        const l = line.trim();
        if (/^user-agent:/i.test(l)) {
          applies = l.slice(11).trim() === "*";
        } else if (applies && /^disallow:/i.test(l)) {
          const path = l.slice(9).trim();
          if (path) disallows.push(path);
        }
      }
    }
  } catch {
    disallows = []; // robots unreachable — proceed politely, rate-limited
  }
  robotsCache.set(origin, { disallows, fetchedAt: Date.now() });
  return disallows;
}

export function isAllowedByRobots(disallows: string[], path: string): boolean {
  return !disallows.some((rule) => path.startsWith(rule));
}

export interface FetchOptions {
  sourceName: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  skipCache?: boolean;
}

export async function politeFetch(url: string, opts: FetchOptions): Promise<string> {
  const u = new URL(url);

  if (!opts.skipCache) {
    const cached = responseCache.get(url);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.body;
  }

  const disallows = await getRobots(u.origin);
  if (!isAllowedByRobots(disallows, u.pathname)) {
    throw new SourceUnavailableError(
      opts.sourceName,
      `robots.txt disallows fetching ${u.pathname} — source marked unavailable`,
    );
  }

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(2 ** attempt * 1000);
    await throttleHost(u.host);
    try {
      const res = await fetch(url, {
        headers: { "user-agent": USER_AGENT, accept: "text/html,application/json,*/*", ...opts.headers },
        signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        redirect: "follow",
      });
      if (res.status === 401 || res.status === 403 || res.status === 429 || res.status === 451) {
        // Access denied / rate limited: do not retry, do not evade.
        throw new SourceUnavailableError(
          opts.sourceName,
          `${u.host} returned HTTP ${res.status} — automated access appears restricted; source marked unavailable`,
        );
      }
      if (!res.ok) {
        lastError = new Error(`HTTP ${res.status} from ${u.host}`);
        continue; // retry 5xx and other transient statuses
      }
      const body = await res.text();
      responseCache.set(url, { body, fetchedAt: Date.now() });
      return body;
    } catch (err) {
      if (err instanceof SourceUnavailableError) throw err;
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw new SourceUnavailableError(
    opts.sourceName,
    `Failed to fetch ${url} after ${MAX_RETRIES + 1} attempts: ${lastError?.message}`,
  );
}

/** Test hook: clear all caches. */
export function _resetHttpState() {
  responseCache.clear();
  robotsCache.clear();
  lastRequestAt.clear();
}
