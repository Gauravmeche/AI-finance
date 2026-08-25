import { NextResponse } from "next/server";
import { queryEvents, type SerializedEvent } from "@/lib/serialize";

export const dynamic = "force-dynamic";

export async function GET() {
  const events = await queryEvents({ window: "upcoming", sort: "finalExpiryDate", order: "asc" });
  const buckets: Record<string, SerializedEvent[]> = { next7: [], next30: [], next60: [], next90: [], later: [] };
  for (const e of events) {
    const d = e.daysRemaining;
    if (d === null) continue;
    if (d <= 7) buckets.next7.push(e);
    else if (d <= 30) buckets.next30.push(e);
    else if (d <= 60) buckets.next60.push(e);
    else if (d <= 90) buckets.next90.push(e);
    else buckets.later.push(e);
  }
  return NextResponse.json({ buckets });
}
