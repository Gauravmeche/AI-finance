import Link from "next/link";
import { queryEvents, type SerializedEvent } from "@/lib/serialize";
import { CATEGORY_LABELS, fmtDate } from "@/lib/format";
import { ConfidenceBadge, DaysChip, SampleBadge, StatusBadge } from "@/components/badges";

export const dynamic = "force-dynamic";

const BUCKETS: { key: string; label: string; max: number; cls: string }[] = [
  { key: "next7", label: "Next 7 Days", max: 7, cls: "border-danger/50" },
  { key: "next30", label: "Next 30 Days", max: 30, cls: "border-warn/50" },
  { key: "next60", label: "Next 60 Days", max: 60, cls: "border-accent/50" },
  { key: "next90", label: "Next 90 Days", max: 90, cls: "border-edge" },
];

export default async function UpcomingPage() {
  const events = await queryEvents({ window: "upcoming", sort: "finalExpiryDate", order: "asc" });

  const buckets = new Map<string, SerializedEvent[]>(BUCKETS.map((b) => [b.key, []]));
  const later: SerializedEvent[] = [];
  for (const e of events) {
    const d = e.daysRemaining;
    if (d === null) continue;
    const bucket = BUCKETS.find((b) => d <= b.max);
    if (bucket) buckets.get(bucket.key)!.push(e);
    else later.push(e);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Upcoming Lock-ins</h1>
        <p className="text-[13px] text-muted">Grouped by time to expiry — nearest first</p>
      </div>

      {BUCKETS.map((b) => {
        const list = buckets.get(b.key)!;
        return (
          <section key={b.key}>
            <h2 className="text-[12px] uppercase tracking-widest text-muted mb-2">
              {b.label} <span className="num">({list.length})</span>
            </h2>
            {list.length === 0 ? (
              <p className="text-[13px] text-muted border border-edge rounded-lg px-4 py-3 bg-surface">None</p>
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {list.map((e) => (
                  <Link key={e.id} href={`/ipos/${e.ipoId}`} className={`block bg-surface border ${b.cls} rounded-lg p-4 hover:bg-surface-2 transition-colors`}>
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium leading-tight">
                        {e.company} <SampleBadge show={e.isSampleData} />
                      </span>
                      <DaysChip days={e.daysRemaining} />
                    </div>
                    <p className="text-[12px] text-muted mt-1">{CATEGORY_LABELS[e.category] ?? e.category}</p>
                    <p className="num text-[15px] mt-2">{fmtDate(e.finalExpiryDate)}</p>
                    <div className="flex items-center justify-between mt-2">
                      <StatusBadge status={e.verificationStatus} />
                      <ConfidenceBadge score={e.confidenceScore} />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>
        );
      })}

      {later.length > 0 && (
        <section>
          <h2 className="text-[12px] uppercase tracking-widest text-muted mb-2">
            Beyond 90 Days <span className="num">({later.length})</span>
          </h2>
          <div className="border border-edge rounded-lg bg-surface divide-y divide-edge/60">
            {later.map((e) => (
              <Link key={e.id} href={`/ipos/${e.ipoId}`} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-surface-2">
                <span className="text-[13px]">
                  {e.company} <SampleBadge show={e.isSampleData} />{" "}
                  <span className="text-muted">· {CATEGORY_LABELS[e.category] ?? e.category}</span>
                </span>
                <span className="num text-[13px] whitespace-nowrap">{fmtDate(e.finalExpiryDate)}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
