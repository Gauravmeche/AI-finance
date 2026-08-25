import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const sources = await prisma.source.findMany({
    orderBy: { priority: "asc" },
    include: { _count: { select: { records: true } } },
  });
  return NextResponse.json({
    sources: sources.map((s) => ({
      id: s.id,
      name: s.name,
      domain: s.domain,
      sourceType: s.sourceType,
      tier: s.tier,
      priority: s.priority,
      isActive: s.isActive,
      adapterKey: s.adapterKey,
      scrapeMethod: s.scrapeMethod,
      lastSuccessAt: s.lastSuccessAt?.toISOString() ?? null,
      lastErrorAt: s.lastErrorAt?.toISOString() ?? null,
      lastError: s.lastError,
      recordCount: s._count.records,
    })),
  });
}
