import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isSyncRunning } from "@/lib/sync/engine";

export const dynamic = "force-dynamic";

export async function GET() {
  const latest = await prisma.syncRun.findFirst({
    orderBy: { startedAt: "desc" },
    include: { errors: { orderBy: { createdAt: "desc" }, take: 20 } },
  });
  const lastSuccess = await prisma.syncRun.findFirst({
    where: { status: { in: ["COMPLETED", "COMPLETED_WITH_ERRORS"] } },
    orderBy: { startedAt: "desc" },
  });
  return NextResponse.json({
    running: isSyncRunning() || latest?.status === "RUNNING",
    latest,
    lastSuccessfulSyncAt: lastSuccess?.completedAt ?? null,
  });
}
