/**
 * Initial data load: users, the configurable source hierarchy, and an
 * initial full sync (INITIAL_LOAD) so the dashboard is populated on first
 * deploy. Subsequent syncs are incremental via the Sync Now button.
 *
 * Run with: npm run db:seed
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { runSyncPipeline } from "../src/lib/sync/engine";

const prisma = new PrismaClient();

const SOURCES = [
  { name: "NSE India", domain: "nseindia.com", sourceType: "exchange", tier: "TIER1_PRIMARY", priority: 10, adapterKey: "nse", scrapeMethod: "api" },
  { name: "BSE India", domain: "bseindia.com", sourceType: "exchange", tier: "TIER1_PRIMARY", priority: 11, adapterKey: "bse", scrapeMethod: "html" },
  { name: "Demo Exchange Filings", domain: "demo-exchange.example.org", sourceType: "exchange_filing", tier: "TIER1_PRIMARY", priority: 20, adapterKey: "demo_exchange", scrapeMethod: "fixture" },
  { name: "Demo Prospectus Repository", domain: "demo-prospectus.example.org", sourceType: "prospectus", tier: "TIER1_PRIMARY", priority: 21, adapterKey: "demo_prospectus", scrapeMethod: "fixture" },
  { name: "Demo Financial Portal", domain: "demo-portal.example.org", sourceType: "financial_portal", tier: "TIER3_SECONDARY", priority: 60, adapterKey: "demo_portal", scrapeMethod: "fixture" },
] as const;

const USERS = [
  { email: "admin@example.com", name: "Admin User", role: "ADMIN", envVar: "SEED_ADMIN_PASSWORD", fallback: "admin-demo-123" },
  { email: "analyst@example.com", name: "Analyst User", role: "ANALYST", envVar: "SEED_ANALYST_PASSWORD", fallback: "analyst-demo-123" },
  { email: "viewer@example.com", name: "Viewer User", role: "VIEWER", envVar: "SEED_VIEWER_PASSWORD", fallback: "viewer-demo-123" },
] as const;

async function main() {
  for (const u of USERS) {
    const password = process.env[u.envVar] ?? u.fallback;
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        email: u.email,
        name: u.name,
        role: u.role,
        passwordHash: await bcrypt.hash(password, 10),
      },
    });
  }
  console.log("Seeded users (change SEED_*_PASSWORD env vars in production).");

  for (const s of SOURCES) {
    await prisma.source.upsert({
      where: { name: s.name },
      update: { priority: s.priority, adapterKey: s.adapterKey },
      create: { ...s, isActive: true },
    });
  }
  console.log(`Seeded ${SOURCES.length} sources.`);

  await prisma.appConfig.upsert({
    where: { key: "staleness_thresholds_days" },
    update: {},
    create: { key: "staleness_thresholds_days", value: { fresh: 3, aging: 7 } },
  });

  const existing = await prisma.syncRun.count();
  if (existing === 0) {
    console.log("Running initial full sync…");
    const run = await prisma.syncRun.create({ data: { trigger: "INITIAL_LOAD", triggeredBy: "seed" } });
    await runSyncPipeline(run.id);
    const done = await prisma.syncRun.findUnique({ where: { id: run.id } });
    console.log(`Initial sync ${done?.status}: ${done?.iposProcessed} IPOs, ${done?.recordsUpdated} events updated.`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
