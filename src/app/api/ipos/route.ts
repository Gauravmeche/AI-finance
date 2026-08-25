import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? undefined;
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
    include: { company: true, lockInEvents: { select: { id: true, finalExpiryDate: true, verificationStatus: true } } },
    orderBy: { listingDate: "desc" },
    take: 200,
  });
  return NextResponse.json({
    ipos: ipos.map((i) => ({
      id: i.id,
      company: i.company.name,
      ticker: i.company.ticker,
      isin: i.company.isin,
      exchange: i.company.exchange,
      ipoName: i.ipoName,
      listingDate: i.listingDate?.toISOString().slice(0, 10) ?? null,
      issuePrice: i.issuePrice != null ? Number(i.issuePrice) : null,
      listingPrice: i.listingPrice != null ? Number(i.listingPrice) : null,
      issueSizeCr: i.issueSizeCr != null ? Number(i.issueSizeCr) : null,
      status: i.status,
      isSampleData: i.isSampleData,
      lockInEventCount: i.lockInEvents.length,
      nextExpiry:
        i.lockInEvents
          .map((e) => e.finalExpiryDate)
          .filter((d): d is Date => !!d && d >= new Date())
          .sort((a, b) => a.getTime() - b.getTime())[0]
          ?.toISOString()
          .slice(0, 10) ?? null,
    })),
  });
}
