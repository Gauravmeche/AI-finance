import { prisma } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

const STATUS_CLS: Record<string, string> = {
  COMPLETED: "text-ok",
  COMPLETED_WITH_ERRORS: "text-warn",
  RUNNING: "text-accent",
  FAILED: "text-danger",
};

export default async function SyncHistoryPage() {
  const runs = await prisma.syncRun.findMany({
    orderBy: { startedAt: "desc" },
    take: 50,
    include: { errors: true },
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Sync History</h1>
        <p className="text-[13px] text-muted">Every sync run with per-source errors — nothing fails silently</p>
      </div>

      <div className="border border-edge rounded-lg overflow-x-auto bg-surface">
        <table className="term w-full text-[13px]">
          <thead>
            <tr>
              <th>Started</th><th>Trigger</th><th>Status</th><th className="text-right">Duration</th>
              <th className="text-right">IPOs</th><th className="text-right">New</th><th className="text-right">Events Updated</th>
              <th className="text-right">Records</th><th className="text-right">Discrepancies</th>
              <th className="text-right">Sources ✓/✗</th><th>Errors</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => {
              const dur = r.completedAt ? Math.round((r.completedAt.getTime() - r.startedAt.getTime()) / 1000) : null;
              return (
                <tr key={r.id}>
                  <td className="num whitespace-nowrap">{fmtDateTime(r.startedAt.toISOString())}</td>
                  <td className="text-muted">{r.trigger}{r.triggeredBy ? ` · ${r.triggeredBy}` : ""}</td>
                  <td className={STATUS_CLS[r.status] ?? ""}>{r.status.replaceAll("_", " ")}</td>
                  <td className="num text-right">{dur !== null ? `${dur}s` : "…"}</td>
                  <td className="num text-right">{r.iposProcessed}</td>
                  <td className="num text-right">{r.newIposFound}</td>
                  <td className="num text-right">{r.recordsUpdated}</td>
                  <td className="num text-right">{r.recordsFound}</td>
                  <td className={`num text-right ${r.discrepanciesDetected ? "text-alert" : ""}`}>{r.discrepanciesDetected}</td>
                  <td className="num text-right">
                    <span className="text-ok">{r.sourcesChecked}</span>/<span className={r.sourcesFailed ? "text-danger" : "text-muted"}>{r.sourcesFailed}</span>
                  </td>
                  <td className="text-[11px] text-danger max-w-64">
                    {r.errors.map((e) => (
                      <p key={e.id} className="truncate" title={`${e.sourceName}: ${e.errorMessage}`}>
                        {e.sourceName} [{e.errorType}]: {e.errorMessage}
                      </p>
                    ))}
                  </td>
                </tr>
              );
            })}
            {runs.length === 0 && (
              <tr><td colSpan={11} className="text-center text-muted py-8">No sync runs yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
