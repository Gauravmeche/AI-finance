import { NextRequest, NextResponse } from "next/server";
import { parseEventFilters, queryEvents } from "@/lib/serialize";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const events = await queryEvents(parseEventFilters(req.nextUrl.searchParams));
  return NextResponse.json({ events });
}
