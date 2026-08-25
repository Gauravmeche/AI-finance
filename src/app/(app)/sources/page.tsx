import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { fmtDateTime } from "@/lib/format";
import { TierBadge } from "@/components/badges";
import { SourceAdminControls } from "@/components/SourceAdminControls";

export const dynamic = "force-dynamic";

export default async function SourcesPage() {
  const session = await getSession();
  const isAdmin = session?.role === "ADMIN";
  const sources = await prisma.source.findMany({
    orderBy: { priority: "asc" },
    include: { _count: { select: { records: true } } },
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Data Sources</h1>
        <p className="text-[13px] text-muted">
          Configurable source hierarchy — lower priority number = higher authority. Tier 3 sources cross-check but
          never override a primary source. {isAdmin ? "Edit priority or disable sources below." : "Admin role required to edit."}
        </p>
      </div>

      <div className="border border-edge rounded-lg overflow-x-auto bg-surface">
        <table className="term w-full text-[13px]">
          <thead>
            <tr>
              <th>Source</th><th>Tier</th><th className="text-right">Priority</th><th>Type</th><th>Method</th>
              <th className="text-right">Records</th><th>Last Success</th><th>Last Error</th><th>Status</th>
              {isAdmin && <th>Manage</th>}
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => {
              const failing = s.lastErrorAt && (!s.lastSuccessAt || s.lastErrorAt > s.lastSuccessAt);
              return (
                <tr key={s.id}>
                  <td>
                    <span className="font-medium">{s.name}</span>
                    <span className="block text-[11px] text-muted">{s.domain}</span>
                  </td>
                  <td><TierBadge tier={s.tier} /></td>
                  <td className="num text-right">{s.priority}</td>
                  <td className="text-muted">{s.sourceType}</td>
                  <td className="text-muted">{s.scrapeMethod ?? "—"}</td>
                  <td className="num text-right">{s._count.records}</td>
                  <td className="num text-[12px] whitespace-nowrap">{s.lastSuccessAt ? fmtDateTime(s.lastSuccessAt.toISOString()) : "—"}</td>
                  <td className="text-[11px] text-danger max-w-52">
                    <span className="line-clamp-2" title={s.lastError ?? undefined}>{s.lastError ?? "—"}</span>
                  </td>
                  <td>
                    {!s.isActive ? (
                      <span className="text-muted text-[12px]">Inactive</span>
                    ) : failing ? (
                      <span className="text-danger text-[12px]">⊘ Unavailable</span>
                    ) : (
                      <span className="text-ok text-[12px]">● Active</span>
                    )}
                  </td>
                  {isAdmin && (
                    <td><SourceAdminControls sourceId={s.id} isActive={s.isActive} priority={s.priority} /></td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[12px] text-muted max-w-3xl leading-relaxed">
        New sources are added by implementing a <code className="num">SourceAdapter</code> (see{" "}
        <code className="num">src/lib/adapters/</code>) and registering it — no core changes required. Sources that
        block automated access are marked unavailable and never bypassed; the system continues with the remaining
        approved sources.
      </p>
    </div>
  );
}
