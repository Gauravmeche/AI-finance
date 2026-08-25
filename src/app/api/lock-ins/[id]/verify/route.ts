import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { reverifyEvent } from "@/lib/sync/verify-event";

/** Re-run the verification engine for one event on demand (Analyst+). */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole("ANALYST");
    const { id } = await params;
    const outcome = await reverifyEvent(id);
    if (!outcome) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({
      ok: true,
      status: outcome.status,
      recommendedDate: outcome.recommendedDate,
      confidence: outcome.confidence,
      discrepancy: outcome.discrepancy,
    });
  } catch (res) {
    if (res instanceof Response) return res;
    throw res;
  }
}
