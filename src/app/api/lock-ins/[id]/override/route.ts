import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { reverifyEvent } from "@/lib/sync/verify-event";
import { isValidIsoDate } from "@/lib/engine/dates";

const OverrideSchema = z.object({
  overrideDate: z.string().refine(isValidIsoDate, "Must be a valid yyyy-mm-dd date"),
  reason: z.string().min(5).max(2000),
  supportingSourceUrl: z.string().url().max(1000).optional().or(z.literal("")),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole("ANALYST");
    const { id } = await params;
    const body = await req.json().catch(() => null);
    const parsed = OverrideSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const event = await prisma.lockInEvent.findUnique({ where: { id } });
    if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Supersede (never delete) previous overrides — audit trail is preserved,
    // and the underlying scraped data is never touched.
    await prisma.manualOverride.updateMany({ where: { lockInEventId: id, isActive: true }, data: { isActive: false } });
    await prisma.manualOverride.create({
      data: {
        lockInEventId: id,
        overrideDate: new Date(`${parsed.data.overrideDate}T00:00:00Z`),
        reason: parsed.data.reason,
        analystName: session.name,
        userId: session.userId,
        supportingSourceUrl: parsed.data.supportingSourceUrl || null,
      },
    });
    const outcome = await reverifyEvent(id);
    return NextResponse.json({ ok: true, status: outcome?.status, finalDate: outcome?.recommendedDate });
  } catch (res) {
    if (res instanceof Response) return res;
    throw res;
  }
}
