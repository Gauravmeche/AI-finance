"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CATEGORY_LABELS, fmtDate, fmtShares } from "@/lib/format";
import { ConfidenceBadge, DaysChip, FreshnessChip, SampleBadge, StatusBadge } from "./badges";

export interface EventRow {
  id: string;
  ipoId: string;
  company: string;
  ticker: string | null;
  exchange: string | null;
  ipoName: string;
  isSampleData: boolean;
  category: string;
  holderType: string;
  shares: number | null;
  finalExpiryDate: string | null;
  daysRemaining: number | null;
  verificationStatus: string;
  confidenceScore: number | null;
  freshness: string;
  dataAgeDays: number | null;
  sources: { sourceName: string; url: string; tier: string }[];
}

const STATUSES = [
  "VERIFIED", "CROSS_CHECKED", "PRIMARY_SOURCE_ONLY", "SECONDARY_SOURCE_ONLY",
  "DATE_DISCREPANCY", "CALCULATION_REQUIRED", "NEEDS_REVIEW", "SOURCE_UNAVAILABLE", "MANUALLY_VERIFIED",
];

export function EventsTable({ presetNeedsReview = false }: { presetNeedsReview?: boolean }) {
  const [rows, setRows] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [exchange, setExchange] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [windowFilter, setWindowFilter] = useState<"all" | "upcoming" | "expired">(presetNeedsReview ? "all" : "upcoming");
  const [minConfidence, setMinConfidence] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sort, setSort] = useState("finalExpiryDate");
  const [order, setOrder] = useState<"asc" | "desc">("asc");

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (exchange) p.set("exchange", exchange);
    if (category) p.set("category", category);
    if (status) p.set("status", status);
    if (windowFilter !== "all") p.set("window", windowFilter);
    if (minConfidence) p.set("minConfidence", minConfidence);
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (presetNeedsReview) p.set("needsReview", "true");
    p.set("sort", sort);
    p.set("order", order);
    return p.toString();
  }, [q, exchange, category, status, windowFilter, minConfidence, from, to, sort, order, presetNeedsReview]);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/lock-ins?${queryString}`, { cache: "no-store" });
    if (res.ok) setRows((await res.json()).events);
    setLoading(false);
  }, [queryString]);

  useEffect(() => {
    const t = setTimeout(load, 250); // debounce typing
    return () => clearTimeout(t);
  }, [load]);

  function toggleSort(key: string) {
    if (sort === key) setOrder(order === "asc" ? "desc" : "asc");
    else {
      setSort(key);
      setOrder("asc");
    }
  }
  const arrow = (key: string) => (sort === key ? (order === "asc" ? " ↑" : " ↓") : "");

  const selectCls = "bg-background border border-edge rounded px-2 py-1.5 text-[12px] focus:border-accent outline-none";

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search company / ticker / ISIN / IPO…"
          className={`${selectCls} w-64`}
        />
        <select value={exchange} onChange={(e) => setExchange(e.target.value)} className={selectCls}>
          <option value="">All exchanges</option>
          <option value="NSE">NSE</option>
          <option value="BSE">BSE</option>
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={selectCls}>
          <option value="">All lock-in types</option>
          {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        {!presetNeedsReview && (
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectCls}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s.replaceAll("_", " ")}</option>
            ))}
          </select>
        )}
        <select value={windowFilter} onChange={(e) => setWindowFilter(e.target.value as typeof windowFilter)} className={selectCls}>
          <option value="all">Upcoming + expired</option>
          <option value="upcoming">Upcoming only</option>
          <option value="expired">Expired only</option>
        </select>
        <select value={minConfidence} onChange={(e) => setMinConfidence(e.target.value)} className={selectCls}>
          <option value="">Any confidence</option>
          <option value="95">≥ 95 (Very High)</option>
          <option value="85">≥ 85 (High)</option>
          <option value="70">≥ 70 (Medium)</option>
          <option value="50">≥ 50 (Low)</option>
        </select>
        <label className="flex items-center gap-1 text-[12px] text-muted">
          from <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={selectCls} />
        </label>
        <label className="flex items-center gap-1 text-[12px] text-muted">
          to <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={selectCls} />
        </label>
        <div className="ml-auto flex items-center gap-2">
          <a href={`/api/export?format=csv&${queryString}`} className="border border-edge rounded px-2.5 py-1.5 text-[12px] text-muted hover:text-foreground hover:border-muted">⬇ CSV</a>
          <a href={`/api/export?format=xlsx&${queryString}`} className="border border-edge rounded px-2.5 py-1.5 text-[12px] text-muted hover:text-foreground hover:border-muted">⬇ Excel</a>
        </div>
      </div>

      {/* Desktop table */}
      <div className="hidden md:block border border-edge rounded-lg overflow-x-auto bg-surface">
        <table className="term w-full text-[13px]">
          <thead>
            <tr>
              <th className="cursor-pointer select-none" onClick={() => toggleSort("company")}>Company{arrow("company")}</th>
              <th>IPO</th>
              <th>Lock-in Type</th>
              <th className="cursor-pointer select-none text-right" onClick={() => toggleSort("shares")}>Shares{arrow("shares")}</th>
              <th className="cursor-pointer select-none" onClick={() => toggleSort("finalExpiryDate")}>Lock-in Expiry{arrow("finalExpiryDate")}</th>
              <th className="cursor-pointer select-none" onClick={() => toggleSort("daysRemaining")}>Days Remaining{arrow("daysRemaining")}</th>
              <th className="cursor-pointer select-none" onClick={() => toggleSort("status")}>Verification{arrow("status")}</th>
              <th className="cursor-pointer select-none" onClick={() => toggleSort("confidence")}>Confidence{arrow("confidence")}</th>
              <th>Source</th>
              <th>Freshness</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id}>
                <td>
                  <Link href={`/ipos/${e.ipoId}`} className="text-accent hover:underline">{e.company}</Link>{" "}
                  <SampleBadge show={e.isSampleData} />
                  <span className="block text-[11px] text-muted">{e.ticker} · {e.exchange}</span>
                </td>
                <td className="max-w-40 truncate" title={e.ipoName}>{e.ipoName}</td>
                <td title={e.holderType}>{CATEGORY_LABELS[e.category] ?? e.category}</td>
                <td className="num text-right whitespace-nowrap">{fmtShares(e.shares)}</td>
                <td className="num whitespace-nowrap">
                  {e.finalExpiryDate ? fmtDate(e.finalExpiryDate) : <span className="text-danger">Date unavailable</span>}
                </td>
                <td><DaysChip days={e.daysRemaining} /></td>
                <td><StatusBadge status={e.verificationStatus} /></td>
                <td><ConfidenceBadge score={e.confidenceScore} /></td>
                <td>
                  {e.sources.slice(0, 2).map((s) => (
                    <a key={s.url + s.sourceName} href={s.url} target="_blank" rel="noopener noreferrer" className="block text-[11px] text-accent hover:underline truncate max-w-36" title={s.sourceName}>
                      {s.sourceName} ↗
                    </a>
                  ))}
                  {e.sources.length > 2 && <span className="text-[11px] text-muted">+{e.sources.length - 2} more</span>}
                </td>
                <td><FreshnessChip freshness={e.freshness} ageDays={e.dataAgeDays} /></td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={10} className="text-center text-muted py-8">No lock-in events match the current filters.</td></tr>
            )}
            {loading && rows.length === 0 && (
              <tr><td colSpan={10} className="text-center text-muted py-8">Loading…</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-2">
        {rows.map((e) => (
          <Link key={e.id} href={`/ipos/${e.ipoId}`} className="block bg-surface border border-edge rounded-lg p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{e.company} <SampleBadge show={e.isSampleData} /></span>
              <DaysChip days={e.daysRemaining} />
            </div>
            <p className="text-[12px] text-muted mt-0.5">{CATEGORY_LABELS[e.category] ?? e.category} · {fmtShares(e.shares)} shares</p>
            <div className="flex items-center justify-between mt-2">
              <span className="num text-[13px]">{e.finalExpiryDate ? fmtDate(e.finalExpiryDate) : "Date unavailable"}</span>
              <StatusBadge status={e.verificationStatus} />
            </div>
          </Link>
        ))}
      </div>

      <p className="text-[11px] text-muted">{rows.length} events{loading ? " · refreshing…" : ""}</p>
    </div>
  );
}
