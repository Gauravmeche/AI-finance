import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";

const NoteSchema = z.object({ note: z.string().min(1).max(4000) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole("ANALYST");
    const { id } = await params;
    const parsed = NoteSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid note" }, { status: 400 });
    const event = await prisma.lockInEvent.findUnique({ where: { id } });
    if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const note = await prisma.reviewNote.create({
      data: { lockInEventId: id, userId: session.userId, authorName: session.name, note: parsed.data.note },
    });
    return NextResponse.json({ ok: true, note });
  } catch (res) {
    if (res instanceof Response) return res;
    throw res;
  }
}
