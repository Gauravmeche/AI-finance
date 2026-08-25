import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { serializeEvent } from "@/lib/serialize";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const event = await prisma.lockInEvent.findUnique({
    where: { id },
    include: {
      ipo: { include: { company: true } },
      sourceRecords: { include: { source: true }, orderBy: { retrievedAt: "desc" } },
      overrides: true,
      verificationResults: { orderBy: { createdAt: "desc" }, take: 10 },
    },
  });
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({
    event: {
      ...serializeEvent(event),
      verificationHistory: event.verificationResults.map((v) => ({
        status: v.status,
        recommendedDate: v.recommendedDate?.toISOString().slice(0, 10) ?? null,
        confidenceScore: v.confidenceScore,
        factors: v.factors,
        comparison: v.comparison,
        createdAt: v.createdAt.toISOString(),
      })),
    },
  });
}
