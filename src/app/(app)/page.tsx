import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { queryEvents } from "@/lib/serialize";
import { fmtDateTime, fmtDate, CATEGORY_LABELS } from "@/lib/format";
import { SyncButton } from "@/components/SyncButton";
import { ConfidenceBadge, DaysChip, SampleBadge, StatusBadge } from "@/components/badges";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await getSession();
  const [lastSync, iposTracked, sources, upcoming, reviewEvents] = await Promise.all([
    prisma.syncRun.findFirst({
      where: { status: { in: ["COMPLETED", "COMPLETED_WITH_ERRORS"] } },
      orderBy: { startedAt: "desc" },
    }),
    prisma.ipo.count(),
    prisma.source.findMany({ orderBy: { priority: "asc" } }),
    queryEvents({ window: "upcoming", sort: "finalExpiryDate", order: "asc" }),
    queryEvents({ needsReview: true }),
  ]);

  const activeSources = sources.filter((s) => s.isActive);
  const failedSources = activeSources.filter((s) => s.lastErrorAt && (!s.lastSuccessAt || s.lastErrorAt > s.lastSuccessAt));
  const next7 = upcoming.filter((e) => e.daysRemaining !== null && e.daysRemaining <= 7);
  const next30 = upcoming.filter((e) => e.daysRemaining !== null && e.daysRemaining <= 30);
  const next90 = upcoming.filter((e) => e.daysRemaining !== null && e.daysRemaining <= 90);
  const discrepancies = reviewEvents.filter((e) => e.verificationStatus === "DATE_DISCREPANCY");
  const healthy = lastSync && failedSources.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">India IPO Lock-in Tracker</h1>
          <p className="text-[13px] text-muted mt-0.5">Source-verified upcoming IPO lock-in expiries</p>
        </div>
        <SyncButton canSync={session?.role === "ADMIN"} />
      </div>

      {/* Status strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-px bg-edge border border-edge rounded-lg overflow-hidden">
        <Stat label="Last Sync" value={lastSync ? fmtDateTime(lastSync.completedAt?.toISOString()) : "Never"} small />
        <Stat
          label="Data Status"
          value={healthy ? "✓ Healthy" : lastSync ? "⚠ Degraded" : "No data"}
          cls={healthy ? "text-ok" : "text-warn"}
        />
        <Stat label="Sources Checked" value={String(lastSync?.sourcesChecked ?? 0)} suffix={`of ${activeSources.length} active`} />
        <Stat label="IPOs Tracked" value={String(iposTracked)} />
        <Stat label="Upcoming Lock-ins" value={String(upcoming.length)} />
        <Stat label="Requires Review" value={String(reviewEvents.length)} cls={reviewEvents.length ? "text-danger" : "text-ok"} />
      </div>

      {/* Alerts */}
      {(reviewEvents.length > 0 || failedSources.length > 0) && (
        <div className="border border-warn/40 bg-warn/5 rounded-lg p-4">
          <p className="text-warn text-[13px] font-medium mb-2">
            ⚠ {reviewEvents.length} lock-in event{reviewEvents.length === 1 ? "" : "s"} require verification
            {failedSources.length > 0 && ` · ${failedSources.length} source${failedSources.length === 1 ? "" : "s"} unavailable`}
          </p>
          <ul className="space-y-1 text-[13px]">
            {discrepancies.map((e) => (
              <li key={e.id}>
                <Link href={`/ipos/${e.ipoId}`} className="text-accent hover:underline">{e.company}</Link>
                <span className="text-muted"> — sources disagree on {CATEGORY_LABELS[e.category] ?? e.category} expiry date</span>
              </li>
            ))}
            {reviewEvents.filter((e) => e.verificationStatus !== "DATE_DISCREPANCY").slice(0, 5).map((e) => (
              <li key={e.id}>
                <Link href={`/ipos/${e.ipoId}`} className="text-accent hover:underline">{e.company}</Link>
                <span className="text-muted">
                  {" "}— {e.verificationStatus === "NEEDS_REVIEW" ? "extraction confidence is low / date unavailable" : "source unavailable"}
                </span>
              </li>
            ))}
            {failedSources.map((s) => (
              <li key={s.id}>
                <Link href="/sources" className="text-accent hover:underline">{s.name}</Link>
                <span className="text-muted"> — {s.lastError?.slice(0, 90)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Bucket cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <BucketCard title="Next 7 Days" count={next7.length} href="/upcoming" accent="danger" />
        <BucketCard title="Next 30 Days" count={next30.length} href="/upcoming" accent="warn" />
        <BucketCard title="Next 90 Days" count={next90.length} href="/upcoming" accent="accent" />
        <BucketCard title="Requires Review" count={reviewEvents.length} href="/review" accent={reviewEvents.length ? "danger" : "ok"} />
      </div>

      {/* Upcoming preview table */}
      <section>
        <div className="flex items-baseline justify-between mb-2">
          <h2 className="text-[13px] uppercase tracking-wider text-muted">Nearest upcoming lock-in expiries</h2>
          <Link href="/events" className="text-[12px] text-accent hover:underline">Full table →</Link>
        </div>
        <div className="border border-edge rounded-lg overflow-x-auto bg-surface">
          <table className="term w-full text-[13px]">
            <thead>
              <tr>
                <th>Company</th><th>Lock-in Type</th><th>Expiry</th><th>Days</th><th>Verification</th><th>Confidence</th>
              </tr>
            </thead>
            <tbody>
              {upcoming.slice(0, 10).map((e) => (
                <tr key={e.id}>
                  <td>
                    <Link href={`/ipos/${e.ipoId}`} className="text-accent hover:underline">{e.company}</Link>{" "}
                    <SampleBadge show={e.isSampleData} />
                    <span className="block text-[11px] text-muted">{e.ticker}</span>
                  </td>
                  <td>{CATEGORY_LABELS[e.category] ?? e.category}</td>
                  <td className="num whitespace-nowrap">{fmtDate(e.finalExpiryDate)}</td>
                  <td><DaysChip days={e.daysRemaining} /></td>
                  <td><StatusBadge status={e.verificationStatus} /></td>
                  <td><ConfidenceBadge score={e.confidenceScore} /></td>
                </tr>
              ))}
              {upcoming.length === 0 && (
                <tr><td colSpan={6} className="text-muted text-center py-6">No upcoming lock-ins. Run a sync to load data.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, suffix, cls, small }: { label: string; value: string; suffix?: string; cls?: string; small?: boolean }) {
  return (
    <div className="bg-surface p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted">{label}</p>
      <p className={`num mt-1 ${small ? "text-[12px]" : "text-lg"} ${cls ?? ""}`}>{value}</p>
      {suffix && <p className="text-[10px] text-muted">{suffix}</p>}
    </div>
  );
}

function BucketCard({ title, count, href, accent }: { title: string; count: number; href: string; accent: string }) {
  const border: Record<string, string> = {
    danger: "border-danger/40",
    warn: "border-warn/40",
    accent: "border-accent/40",
    ok: "border-ok/40",
  };
  return (
    <Link href={href} className={`block bg-surface border ${border[accent] ?? "border-edge"} rounded-lg p-4 hover:bg-surface-2 transition-colors`}>
      <p className="text-[11px] uppercase tracking-wider text-muted">{title}</p>
      <p className="num text-2xl mt-1">{count}</p>
    </Link>
  );
}
