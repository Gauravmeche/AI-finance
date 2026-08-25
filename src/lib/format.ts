/** Display formatting helpers shared by UI components. */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${String(d).padStart(2, "0")} ${MONTHS[m - 1]} ${y}`;
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${fmtDate(iso)}, ${d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" })} IST`;
}

export function fmtShares(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1e7) return `${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(2)} L`;
  return n.toLocaleString("en-IN");
}

export function fmtDaysRemaining(days: number | null | undefined): string {
  if (days == null) return "—";
  if (days < 0) return "Expired";
  if (days === 0) return "Today";
  return `${days} day${days === 1 ? "" : "s"}`;
}

export const STATUS_META: Record<string, { label: string; dot: string; cls: string }> = {
  VERIFIED: { label: "Verified", dot: "🟢", cls: "text-ok" },
  CROSS_CHECKED: { label: "Cross-checked", dot: "🟢", cls: "text-ok" },
  PRIMARY_SOURCE_ONLY: { label: "Primary only", dot: "🔵", cls: "text-accent" },
  SECONDARY_SOURCE_ONLY: { label: "Secondary only", dot: "🟡", cls: "text-warn" },
  CALCULATION_REQUIRED: { label: "Calculated", dot: "🟡", cls: "text-warn" },
  DATE_DISCREPANCY: { label: "Discrepancy", dot: "🟠", cls: "text-alert" },
  NEEDS_REVIEW: { label: "Needs review", dot: "🔴", cls: "text-danger" },
  SOURCE_UNAVAILABLE: { label: "Source unavailable", dot: "🔴", cls: "text-danger" },
  MANUALLY_VERIFIED: { label: "Manually verified", dot: "🟣", cls: "text-manual" },
};

export function confidenceBand(score: number | null | undefined): { label: string; cls: string } {
  if (score == null) return { label: "—", cls: "text-muted" };
  if (score >= 95) return { label: "Very High", cls: "text-ok" };
  if (score >= 85) return { label: "High", cls: "text-ok" };
  if (score >= 70) return { label: "Medium", cls: "text-warn" };
  if (score >= 50) return { label: "Low", cls: "text-alert" };
  return { label: "Needs Review", cls: "text-danger" };
}

export const CATEGORY_LABELS: Record<string, string> = {
  ANCHOR_50PCT: "Anchor (50% tranche)",
  ANCHOR_REMAINING: "Anchor (remaining)",
  PROMOTER_MINIMUM_CONTRIBUTION: "Promoter (min. contribution)",
  PROMOTER_EXCESS: "Promoter (excess)",
  PRE_IPO_SHAREHOLDER: "Pre-IPO shareholders",
  EXISTING_SHAREHOLDER: "Existing shareholders",
  OTHER: "Other",
};
