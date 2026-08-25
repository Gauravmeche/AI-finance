import Link from "next/link";
import { prisma } from "@/lib/db";
import { fmtDate } from "@/lib/format";
import { SampleBadge } from "@/components/badges";

export const dynamic = "force-dynamic";

export default async function IposPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const ipos = await prisma.ipo.findMany({
    where: q
      ? {
          OR: [
            { company: { name: { contains: q, mode: "insensitive" } } },
            { company: { ticker: { contains: q, mode: "insensitive" } } },
            { company: { isin: { contains: q, mode: "insensitive" } } },
            { ipoName: { contains: q, mode: "insensitive" } },
          ],
        }
      : undefined,
    include: { company: true, lockInEvents: true },
    orderBy: { listingDate: "desc" },
    take: 200,
  });
  const today = new Date();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">All IPOs</h1>
          <p className="text-[13px] text-muted">{ipos.length} tracked</p>
        </div>
        <form className="flex gap-2">
          <input
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search company / ticker / ISIN…"
            className="bg-background border border-edge rounded px-3 py-1.5 text-[13px] w-64 focus:border-accent outline-none"
          />
          <button className="border border-edge rounded px-3 py-1.5 text-[13px] text-muted hover:text-foreground">Search</button>
        </form>
      </div>

      <div className="border border-edge rounded-lg overflow-x-auto bg-surface">
        <table className="term w-full text-[13px]">
          <thead>
            <tr>
              <th>Company</th><th>Ticker / ISIN</th><th>Exchange</th><th>Listing Date</th>
              <th className="text-right">Issue ₹</th><th className="text-right">Listing ₹</th>
              <th className="text-right">Size (₹ Cr)</th><th>Lock-ins</th><th>Next Expiry</th>
            </tr>
          </thead>
          <tbody>
            {ipos.map((i) => {
              const next = i.lockInEvents
                .map((e) => e.finalExpiryDate)
                .filter((d): d is Date => !!d && d >= today)
                .sort((a, b) => a.getTime() - b.getTime())[0];
              return (
                <tr key={i.id}>
                  <td>
                    <Link href={`/ipos/${i.id}`} className="text-accent hover:underline">{i.company.name}</Link>{" "}
                    <SampleBadge show={i.isSampleData} />
                  </td>
                  <td className="num text-[12px]">{i.company.ticker ?? "—"}<span className="block text-muted">{i.company.isin ?? ""}</span></td>
                  <td>{i.company.exchange ?? "—"}</td>
                  <td className="num whitespace-nowrap">{fmtDate(i.listingDate?.toISOString())}</td>
                  <td className="num text-right">{i.issuePrice ? Number(i.issuePrice).toLocaleString("en-IN") : "—"}</td>
                  <td className="num text-right">{i.listingPrice ? Number(i.listingPrice).toLocaleString("en-IN") : "—"}</td>
                  <td className="num text-right">{i.issueSizeCr ? Number(i.issueSizeCr).toLocaleString("en-IN") : "—"}</td>
                  <td className="num">{i.lockInEvents.length}</td>
                  <td className="num whitespace-nowrap">{next ? fmtDate(next.toISOString()) : "—"}</td>
                </tr>
              );
            })}
            {ipos.length === 0 && (
              <tr><td colSpan={9} className="text-center text-muted py-8">No IPOs found{q ? ` for "${q}"` : ""}.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
