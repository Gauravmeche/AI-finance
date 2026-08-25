import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";

const PatchSchema = z.object({
  isActive: z.boolean().optional(),
  priority: z.number().int().min(0).max(1000).optional(),
  name: z.string().min(1).max(200).optional(),
  domain: z.string().min(1).max(200).optional(),
  sourceType: z.string().min(1).max(100).optional(),
  tier: z.enum(["TIER1_PRIMARY", "TIER2_RELIABLE", "TIER3_SECONDARY"]).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole("ADMIN");
    const { id } = await params;
    const parsed = PatchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    const source = await prisma.source.update({ where: { id }, data: parsed.data }).catch(() => null);
    if (!source) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (res) {
    if (res instanceof Response) return res;
    throw res;
  }
}
