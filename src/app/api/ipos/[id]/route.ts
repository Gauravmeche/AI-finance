import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { serializeEvent } from "@/lib/serialize";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ipo = await prisma.ipo.findUnique({
    where: { id },
    include: {
      company: true,
      lockInEvents: {
        include: {
          ipo: { include: { company: true } },
          sourceRecords: { include: { source: true }, orderBy: { retrievedAt: "desc" } },
          overrides: true,
          verificationResults: { orderBy: { createdAt: "desc" }, take: 5 },
          reviewNotes: { orderBy: { createdAt: "desc" } },
        },
      },
    },
  });
  if (!ipo) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({
    ipo: {
      id: ipo.id,
      company: ipo.company.name,
      legalName: ipo.company.legalName,
      ticker: ipo.company.ticker,
      isin: ipo.company.isin,
      exchange: ipo.company.exchange,
      ipoName: ipo.ipoName,
      issueOpenDate: ipo.issueOpenDate?.toISOString().slice(0, 10) ?? null,
      issueCloseDate: ipo.issueCloseDate?.toISOString().slice(0, 10) ?? null,
      listingDate: ipo.listingDate?.toISOString().slice(0, 10) ?? null,
      issuePrice: ipo.issuePrice != null ? Number(ipo.issuePrice) : null,
      listingPrice: ipo.listingPrice != null ? Number(ipo.listingPrice) : null,
      issueSizeCr: ipo.issueSizeCr != null ? Number(ipo.issueSizeCr) : null,
      status: ipo.status,
      isSampleData: ipo.isSampleData,
    },
    events: ipo.lockInEvents.map((e) => ({
      ...serializeEvent(e),
      verificationHistory: e.verificationResults.map((v) => ({
        id: v.id,
        status: v.status,
        recommendedDate: v.recommendedDate?.toISOString().slice(0, 10) ?? null,
        confidenceScore: v.confidenceScore,
        factors: v.factors,
        comparison: v.comparison,
        createdAt: v.createdAt.toISOString(),
      })),
      reviewNotes: e.reviewNotes.map((n) => ({
        id: n.id,
        authorName: n.authorName,
        note: n.note,
        createdAt: n.createdAt.toISOString(),
      })),
      overrideHistory: e.overrides.map((o) => ({
        id: o.id,
        date: o.overrideDate.toISOString().slice(0, 10),
        reason: o.reason,
        analystName: o.analystName,
        supportingSourceUrl: o.supportingSourceUrl,
        isActive: o.isActive,
        createdAt: o.createdAt.toISOString(),
      })),
    })),
  });
}
