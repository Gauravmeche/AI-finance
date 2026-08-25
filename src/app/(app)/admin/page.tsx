import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { fmtDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await getSession();
  if (session?.role !== "ADMIN") redirect("/");

  const [lastRun, runCount, errorCount, recordCount, eventCount, verificationCount, users, config] = await Promise.all([
    prisma.syncRun.findFirst({ orderBy: { startedAt: "desc" }, include: { errors: true } }),
    prisma.syncRun.count(),
    prisma.syncError.count(),
    prisma.sourceRecord.count(),
    prisma.lockInEvent.count(),
    prisma.verificationResult.count(),
    prisma.user.findMany({ orderBy: { role: "asc" }, select: { email: true, name: true, role: true, createdAt: true } }),
    prisma.appConfig.findMany(),
  ]);

  const dur = lastRun?.completedAt ? Math.round((lastRun.completedAt.getTime() - lastRun.startedAt.getTime()) / 1000) : null;

  const stats: [string, string][] = [
    ["Last Sync", lastRun ? fmtDateTime(lastRun.startedAt.toISOString()) : "Never"],
    ["Sync Duration", dur !== null ? `${dur}s` : "—"],
    ["Records Processed", String(lastRun?.recordsFound ?? 0)],
    ["Records Created", String(lastRun?.recordsCreated ?? 0)],
    ["Records Updated", String(lastRun?.recordsUpdated ?? 0)],
    ["Records Failed", String(lastRun?.recordsFailed ?? 0)],
    ["Sources Successful", String(lastRun?.sourcesChecked ?? 0)],
    ["Sources Failed", String(lastRun?.sourcesFailed ?? 0)],
    ["Total Sync Runs", String(runCount)],
    ["Total Sync Errors", String(errorCount)],
    ["Evidence Records", String(recordCount)],
    ["Lock-in Events", String(eventCount)],
    ["Verification Passes", String(verificationCount)],
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Admin · Observability</h1>
        <p className="text-[13px] text-muted">System health, users and configuration</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-px bg-edge border border-edge rounded-lg overflow-hidden">
        {stats.map(([k, v]) => (
          <div key={k} className="bg-surface p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted">{k}</p>
            <p className="num text-[15px] mt-0.5">{v}</p>
          </div>
        ))}
      </div>

      {lastRun && lastRun.errors.length > 0 && (
        <section>
          <h2 className="text-[12px] uppercase tracking-widest text-muted mb-2">Last run errors</h2>
          <div className="border border-edge rounded-lg bg-surface divide-y divide-edge/60 text-[12px]">
            {lastRun.errors.map((e) => (
              <div key={e.id} className="px-4 py-2">
                <span className="text-danger">{e.sourceName}</span>
                <span className="text-muted"> [{e.errorType}] {e.errorMessage}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="text-[12px] uppercase tracking-widest text-muted mb-2">Users</h2>
        <div className="border border-edge rounded-lg overflow-x-auto bg-surface">
          <table className="term w-full text-[13px]">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Created</th></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.email}>
                  <td>{u.name}</td>
                  <td className="text-muted">{u.email}</td>
                  <td><span className="text-[11px] uppercase tracking-wider">{u.role}</span></td>
                  <td className="num text-[12px]">{fmtDateTime(u.createdAt.toISOString())}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-muted mt-1">User management is via the seed script / database in this MVP.</p>
      </section>

      <section>
        <h2 className="text-[12px] uppercase tracking-widest text-muted mb-2">Configuration</h2>
        <div className="border border-edge rounded-lg bg-surface divide-y divide-edge/60 text-[12px]">
          {config.map((c) => (
            <div key={c.key} className="px-4 py-2 flex gap-4">
              <span className="text-muted w-56 shrink-0">{c.key}</span>
              <code className="num text-foreground/80">{JSON.stringify(c.value)}</code>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted mt-1 max-w-2xl">
          Scheduled sync is supported by the architecture: point a cron (Vercel Cron, system cron, or a worker) at{" "}
          <code className="num">POST /api/sync</code> with an admin session — e.g. daily at 6:00 AM IST. Manual sync
          remains the primary mechanism.
        </p>
      </section>
    </div>
  );
}
