import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { parseEventFilters, queryEvents, type SerializedEvent } from "@/lib/serialize";

export const dynamic = "force-dynamic";

const COLUMNS: { header: string; value: (e: SerializedEvent) => string | number | null }[] = [
  { header: "Company", value: (e) => e.company },
  { header: "Ticker", value: (e) => e.ticker },
  { header: "ISIN", value: (e) => e.isin },
  { header: "Exchange", value: (e) => e.exchange },
  { header: "IPO", value: (e) => e.ipoName },
  { header: "Listing Date", value: (e) => e.listingDate },
  { header: "Lock-in Category", value: (e) => e.category },
  { header: "Holder Type", value: (e) => e.holderType },
  { header: "Shares", value: (e) => e.shares },
  { header: "% of Post-Issue Capital", value: (e) => e.percentage },
  { header: "Lock-in Period", value: (e) => (e.lockInPeriod ? `${e.lockInPeriod} ${e.periodUnit?.toLowerCase()}` : null) },
  { header: "Start Date", value: (e) => e.startDate },
  { header: "Calculated Expiry", value: (e) => e.calculatedExpiryDate },
  { header: "Published Expiry", value: (e) => e.publishedExpiryDate },
  { header: "Final Expiry", value: (e) => e.finalExpiryDate },
  { header: "Days Remaining", value: (e) => e.daysRemaining },
  { header: "Verification Status", value: (e) => e.verificationStatus },
  { header: "Confidence", value: (e) => e.confidenceScore },
  { header: "Calculation Method", value: (e) => e.calculationMethod },
  { header: "Manual Override", value: (e) => (e.activeOverride ? `${e.activeOverride.date} (${e.activeOverride.analystName})` : null) },
  { header: "Sources", value: (e) => e.sources.map((s) => s.sourceName).join("; ") },
  { header: "Source URLs", value: (e) => e.sources.map((s) => s.url).join("; ") },
  { header: "Last Verified", value: (e) => e.lastVerifiedAt },
  { header: "Sample Data", value: (e) => (e.isSampleData ? "YES (fictional demo record)" : "no") },
];

export async function GET(req: NextRequest) {
  const format = req.nextUrl.searchParams.get("format") ?? "csv";
  const events = await queryEvents(parseEventFilters(req.nextUrl.searchParams));
  const stamp = new Date().toISOString().slice(0, 10);

  if (format === "xlsx") {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Lock-in Events");
    ws.addRow(COLUMNS.map((c) => c.header));
    ws.getRow(1).font = { bold: true };
    for (const e of events) ws.addRow(COLUMNS.map((c) => c.value(e)));
    ws.columns.forEach((col) => (col.width = 18));
    const buffer = await wb.xlsx.writeBuffer();
    return new NextResponse(buffer, {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="lockin-events-${stamp}.xlsx"`,
      },
    });
  }

  const escape = (v: string | number | null) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [
    COLUMNS.map((c) => escape(c.header)).join(","),
    ...events.map((e) => COLUMNS.map((c) => escape(c.value(e))).join(",")),
  ].join("\n");
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="lockin-events-${stamp}.csv"`,
    },
  });
}
