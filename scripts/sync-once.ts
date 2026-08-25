/** Run one full sync from the command line (used for testing and for
 *  refreshing a remote database: `npx tsx scripts/sync-once.ts`). */
import { PrismaClient } from "@prisma/client";
import { runSyncPipeline } from "../src/lib/sync/engine";

async function main() {
  const prisma = new PrismaClient();
  const run = await prisma.syncRun.create({ data: { trigger: "MANUAL", triggeredBy: "cli" } });
  await runSyncPipeline(run.id);
  const done = await prisma.syncRun.findUnique({ where: { id: run.id }, include: { errors: true } });
  console.log("status:", done!.status, "| ipos:", done!.iposProcessed, "| events updated:", done!.recordsUpdated, "| discrepancies:", done!.discrepanciesDetected);
  for (const e of done!.errors) console.log("source error:", e.sourceName, "-", e.errorType, "-", e.errorMessage.slice(0, 80));
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
