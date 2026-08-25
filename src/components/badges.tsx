import { confidenceBand, fmtDaysRemaining, STATUS_META } from "@/lib/format";

export function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? { label: status, dot: "⚪", cls: "text-muted" };
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap ${meta.cls}`}>
      <span className="text-[9px] leading-none">{meta.dot}</span>
      <span className="text-[12px]">{meta.label}</span>
    </span>
  );
}

export function ConfidenceBadge({ score }: { score: number | null }) {
  const band = confidenceBand(score);
  return (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
      <span className={`num text-[13px] ${band.cls}`}>{score ?? "—"}</span>
      <span className="text-[11px] text-muted">{band.label}</span>
    </span>
  );
}

export function DaysChip({ days }: { days: number | null }) {
  const label = fmtDaysRemaining(days);
  const cls =
    days === null
      ? "text-muted border-edge"
      : days < 0
        ? "text-muted border-edge line-through decoration-muted/50"
        : days <= 7
          ? "text-danger border-danger/40 bg-danger/10"
          : days <= 30
            ? "text-warn border-warn/40 bg-warn/10"
            : "text-foreground border-edge";
  return <span className={`num inline-block border rounded px-1.5 py-0.5 text-[12px] whitespace-nowrap ${cls}`}>{label}</span>;
}

export function SampleBadge({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span
      className="inline-block border border-manual/50 text-manual rounded px-1 py-px text-[9px] uppercase tracking-wide align-middle"
      title="Fictional demonstration record — not real market data"
    >
      demo
    </span>
  );
}

export function FreshnessChip({ freshness, ageDays }: { freshness: string; ageDays: number | null }) {
  const cls = freshness === "fresh" ? "text-ok" : freshness === "aging" ? "text-warn" : "text-danger";
  const label = freshness === "unknown" ? "no data" : `${freshness}${ageDays !== null ? ` · ${ageDays}d` : ""}`;
  return <span className={`text-[11px] ${cls}`}>{label}</span>;
}

export function TierBadge({ tier }: { tier: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    TIER1_PRIMARY: { label: "Tier 1 · Primary", cls: "text-ok border-ok/40" },
    TIER2_RELIABLE: { label: "Tier 2 · Reliable", cls: "text-accent border-accent/40" },
    TIER3_SECONDARY: { label: "Tier 3 · Secondary", cls: "text-warn border-warn/40" },
  };
  const m = map[tier] ?? { label: tier, cls: "text-muted border-edge" };
  return <span className={`inline-block border rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${m.cls}`}>{m.label}</span>;
}
