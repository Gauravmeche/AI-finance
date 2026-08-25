import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { startSync } from "@/lib/sync/engine";

export async function POST() {
  try {
    const session = await requireRole("ADMIN");
    const result = await startSync("MANUAL", session.email);
    if ("error" in result) return NextResponse.json(result, { status: 409 });
    return NextResponse.json(result, { status: 202 });
  } catch (res) {
    if (res instanceof Response) return res;
    throw res;
  }
}
