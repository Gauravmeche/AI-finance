import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession, hasRole } from "@/lib/auth/session";
import { serializeEvent } from "@/lib/serialize";
import { CATEGORY_LABELS, fmtDate, fmtDateTime, fmtShares } from "@/lib/format";
import { ConfidenceBadge, DaysChip, SampleBadge, StatusBadge, TierBadge } from "@/components/badges";
import { EventActions } from "@/components/EventActions";

export const dynamic = "force-dynamic";

interface Factor {
  factor: string;
  points: number;
  maxPoints: number;
  met: boolean;
  detail: string;
}
interface Comparison {
  sourceDates?: { sourceName: string; date: string; sourceTier: string; url: string }[];
  calculatedDate?: string | null;
  discrepancy?: {
    dates: { date: string; sources: { sourceName: string; sourceTier: string }[] }[];
    authoritativeSource: string;
    authoritativeDate: string;
    explanation: string;
  } | null;
}

export default async function IpoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  const canAct = hasRole(session, "ANALYST");

  const ipo = await prisma.ipo.findUnique({
    where: { id },
    include: {
      company: true,
      lockInEvents: {
        include: {
          ipo: { include: { company: true } },
          sourceRecords: { include: { source: true }, orderBy: { retrievedAt: "desc" } },
          overrides: { orderBy: { createdAt: "desc" } },
          verificationResults: { orderBy: { createdAt: "desc" }, take: 1 },
          reviewNotes: { orderBy: { createdAt: "desc" } },
        },
        orderBy: { finalExpiryDate: { sort: "asc", nulls: "last" } },
      },
    },
  });
  if (!ipo) notFound();

  const info: [string, string][] = [
    ["Listing Date", fmtDate(ipo.listingDate?.toISOString())],
    ["Issue Open", fmtDate(ipo.issueOpenDate?.toISOString())],
    ["Issue Close", fmtDate(ipo.issueCloseDate?.toISOString())],
    ["Issue Price", ipo.issuePrice ? `₹${Number(ipo.issuePrice).toLocaleString("en-IN")}` : "—"],
    ["Listing Price", ipo.listingPrice ? `₹${Number(ipo.listingPrice).toLocaleString("en-IN")}` : "—"],
    ["Issue Size", ipo.issueSizeCr ? `₹${Number(ipo.issueSizeCr).toLocaleString("en-IN")} Cr` : "—"],
    ["Exchange", ipo.company.exchange ?? "—"],
    ["ISIN", ipo.company.isin ?? "—"],
  ];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/ipos" className="text-[12px] text-muted hover:text-foreground">← All IPOs</Link>
        <h1 className="text-xl font-semibold tracking-tight mt-1">
          {ipo.company.name} <SampleBadge show={ipo.isSampleData} />
        </h1>
        <p className="text-[13px] text-muted">
          {ipo.ipoName} · {ipo.company.ticker ?? "—"}
        </p>
        {ipo.isSampleData && (
          <p className="mt-2 text-[12px] text-manual border border-manual/40 bg-manual/5 rounded px-3 py-2 inline-block">
            Fictional demonstration record — populated by the demo source adapters, not real market data.
          </p>
        )}
      </div>

      {/* IPO info */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-edge border border-edge rounded-lg overflow-hidden">
        {info.map(([k, v]) => (
          <div key={k} className="bg-surface p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted">{k}</p>
            <p className="num text-[14px] mt-0.5">{v}</p>
          </div>
        ))}
      </div>

      {/* Lock-in events */}
      <section className="space-y-4">
        <h2 className="text-[13px] uppercase tracking-widest text-muted">Lock-in Events ({ipo.lockInEvents.length})</h2>
        {ipo.lockInEvents.map((raw) => {
          const e = serializeEvent(raw);
          const factors = (e.confidenceFactors ?? []) as unknown as Factor[];
          const comparison = (raw.verificationResults[0]?.comparison ?? {}) as unknown as Comparison;
          const discrepancy = comparison.discrepancy;
          const calcMatches =
            e.calculatedExpiryDate && e.publishedExpiryDate ? e.calculatedExpiryDate === e.publishedExpiryDate : null;

          return (
            <div key={e.id} className="border border-edge rounded-lg bg-surface overflow-hidden">
              {/* Event header */}
              <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-edge bg-surface-2">
                <span className="font-medium">{CATEGORY_LABELS[e.category] ?? e.category}</span>
                <span className="text-[12px] text-muted">{e.holderType}</span>
                <span className="ml-auto flex items-center gap-3">
                  <StatusBadge status={e.verificationStatus} />
                  <ConfidenceBadge score={e.confidenceScore} />
                  <DaysChip days={e.daysRemaining} />
                </span>
              </div>

              <div className="p-4 grid lg:grid-cols-2 gap-6">
                {/* Left: dates & audit trail */}
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3 text-[13px]">
                    <Field label="Shares" value={fmtShares(e.shares)} />
                    <Field label="% Post-issue Capital" value={e.percentage != null ? `${e.percentage}%` : "—"} />
                    <Field label="Lock-in Period" value={e.lockInPeriod ? `${e.lockInPeriod} ${e.periodUnit?.toLowerCase()}` : "Not stated"} />
                    <Field label="Start Date" value={fmtDate(e.startDate)} />
                  </div>

                  <div className="border border-edge rounded p-3 space-y-1.5 text-[13px]">
                    <p className="text-[10px] uppercase tracking-wider text-muted mb-2">Date audit trail — raw → calculated → verified → final</p>
                    <AuditRow label="Calculated" value={fmtDate(e.calculatedExpiryDate)} note={e.calculationMethod ?? undefined} />
                    <AuditRow label="Published" value={fmtDate(e.publishedExpiryDate)} note={e.publishedExpiryDate ? "explicitly stated by source" : "no source publishes an explicit date"} />
                    <AuditRow
                      label="Override"
                      value={e.activeOverride ? fmtDate(e.activeOverride.date) : "—"}
                      note={e.activeOverride ? `${e.activeOverride.analystName}: ${e.activeOverride.reason}` : undefined}
                      cls={e.activeOverride ? "text-manual" : undefined}
                    />
                    <AuditRow
                      label="Final"
                      value={e.finalExpiryDate ? fmtDate(e.finalExpiryDate) : "Date unavailable / Needs Review"}
                      cls={e.finalExpiryDate ? "text-foreground font-medium" : "text-danger"}
                    />
                    {calcMatches !== null && (
                      <p className={`text-[12px] mt-1 ${calcMatches ? "text-ok" : "text-alert"}`}>
                        Calculation check: {calcMatches ? "✓ matches published date" : "✗ does NOT match published date"}
                      </p>
                    )}
                  </div>

                  {e.ruleText && (
                    <div className="text-[12px] text-muted border-l-2 border-edge pl-3">
                      <span className="text-[10px] uppercase tracking-wider block mb-1">Rule as stated</span>
                      {e.ruleText}
                    </div>
                  )}

                  {discrepancy && (
                    <div className="border border-alert/50 bg-alert/5 rounded-lg p-3 text-[13px] space-y-2">
                      <p className="text-alert font-medium">⚠️ Date discrepancy detected</p>
                      <table className="w-full text-[12px]">
                        <tbody>
                          {discrepancy.dates.map((d) => (
                            <tr key={d.date}>
                              <td className="num py-0.5 pr-3 whitespace-nowrap">{fmtDate(d.date)}</td>
                              <td className="text-muted">{d.sources.map((s) => s.sourceName).join(", ")}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="text-[12px] text-muted">{discrepancy.explanation}</p>
                      <p className="text-[12px]">
                        Recommended: <span className="num">{fmtDate(discrepancy.authoritativeDate)}</span>{" "}
                        <span className="text-muted">({discrepancy.authoritativeSource})</span>
                      </p>
                    </div>
                  )}

                  {e.notes && <p className="text-[12px] text-muted">{e.notes}</p>}
                  <EventActions eventId={e.id} canAct={canAct} />
                </div>

                {/* Right: verification + evidence */}
                <div className="space-y-4">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted mb-2">
                      Confidence breakdown — {e.confidenceScore ?? "—"}/100
                    </p>
                    <ul className="space-y-1 text-[12px]">
                      {factors.map((f) => (
                        <li key={f.factor} className="flex gap-2">
                          <span className={f.met ? "text-ok" : "text-muted"}>{f.met ? "✓" : "✗"}</span>
                          <span className="flex-1 text-muted">{f.detail}</span>
                          <span className="num text-muted">{f.points}/{f.maxPoints}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted mb-2">Source evidence ({e.sources.length})</p>
                    <div className="space-y-2">
                      {e.sources.map((s) => (
                        <div key={s.id} className="border border-edge rounded p-3 text-[12px] space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-[13px]">{s.sourceName}</span>
                            <TierBadge tier={s.tier} />
                            <a href={s.url} target="_blank" rel="noopener noreferrer" className="ml-auto text-accent hover:underline whitespace-nowrap">
                              Open Source ↗
                            </a>
                          </div>
                          {s.documentTitle && <p className="text-muted">{s.documentTitle}</p>}
                          <div className="grid grid-cols-2 gap-x-4 text-muted">
                            <span>Published: <span className="num text-foreground/80">{fmtDate(s.publishedDate)}</span></span>
                            <span>Retrieved: <span className="num text-foreground/80">{fmtDateTime(s.retrievedAt)}</span></span>
                            <span>Lock-in date: <span className="num text-foreground/80">{s.extractedValue ? fmtDate(s.extractedValue) : "not stated"}</span></span>
                            <span>Parser confidence: <span className={`num ${s.parserConfidence !== null && s.parserConfidence < 0.5 ? "text-danger" : "text-foreground/80"}`}>{s.parserConfidence?.toFixed(2) ?? "—"}</span></span>
                          </div>
                          {s.extractedText && (
                            <blockquote className="border-l-2 border-edge pl-2 text-muted italic leading-relaxed">
                              “{s.extractedText}”
                            </blockquote>
                          )}
                        </div>
                      ))}
                      {e.sources.length === 0 && <p className="text-[12px] text-danger">No source evidence retrieved.</p>}
                    </div>
                  </div>

                  {(raw.reviewNotes.length > 0 || raw.overrides.length > 0) && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted mb-2">Review history</p>
                      <ul className="space-y-1.5 text-[12px]">
                        {raw.overrides.map((o) => (
                          <li key={o.id} className="text-muted">
                            <span className="text-manual">Override {o.isActive ? "(active)" : "(superseded)"}</span>{" "}
                            → <span className="num">{fmtDate(o.overrideDate.toISOString())}</span> by {o.analystName},{" "}
                            {fmtDateTime(o.createdAt.toISOString())} — {o.reason}
                            {o.supportingSourceUrl && (
                              <>
                                {" "}
                                <a href={o.supportingSourceUrl} className="text-accent hover:underline" target="_blank" rel="noopener noreferrer">source ↗</a>
                              </>
                            )}
                          </li>
                        ))}
                        {raw.reviewNotes.map((n) => (
                          <li key={n.id} className="text-muted">
                            <span className="text-foreground/80">{n.authorName}</span> ({fmtDateTime(n.createdAt.toISOString())}): {n.note}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <p className="text-[11px] text-muted">Last verified: {fmtDateTime(e.lastVerifiedAt)}</p>
                </div>
              </div>
            </div>
          );
        })}
        {ipo.lockInEvents.length === 0 && (
          <p className="text-muted text-[13px] border border-edge rounded-lg px-4 py-6 bg-surface text-center">
            No lock-in events recorded for this IPO yet.
          </p>
        )}
      </section>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted">{label}</p>
      <p className="num">{value}</p>
    </div>
  );
}

function AuditRow({ label, value, note, cls }: { label: string; value: string; note?: string; cls?: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="w-20 shrink-0 text-[11px] uppercase tracking-wider text-muted">{label}</span>
      <span className={`num ${cls ?? "text-foreground/90"}`}>{value}</span>
      {note && <span className="text-[11px] text-muted truncate" title={note}>· {note}</span>}
    </div>
  );
}
