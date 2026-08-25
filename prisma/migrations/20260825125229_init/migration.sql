-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'ANALYST', 'VIEWER');

-- CreateEnum
CREATE TYPE "IpoStatus" AS ENUM ('UPCOMING', 'OPEN', 'LISTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "LockInCategory" AS ENUM ('ANCHOR_50PCT', 'ANCHOR_REMAINING', 'PROMOTER_MINIMUM_CONTRIBUTION', 'PROMOTER_EXCESS', 'PRE_IPO_SHAREHOLDER', 'EXISTING_SHAREHOLDER', 'OTHER');

-- CreateEnum
CREATE TYPE "PeriodUnit" AS ENUM ('DAYS', 'MONTHS', 'YEARS');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('VERIFIED', 'CROSS_CHECKED', 'PRIMARY_SOURCE_ONLY', 'SECONDARY_SOURCE_ONLY', 'DATE_DISCREPANCY', 'CALCULATION_REQUIRED', 'NEEDS_REVIEW', 'SOURCE_UNAVAILABLE', 'MANUALLY_VERIFIED');

-- CreateEnum
CREATE TYPE "SourceTier" AS ENUM ('TIER1_PRIMARY', 'TIER2_RELIABLE', 'TIER3_SECONDARY');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('RUNNING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED');

-- CreateEnum
CREATE TYPE "SyncTrigger" AS ENUM ('MANUAL', 'SCHEDULED', 'API', 'INITIAL_LOAD');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'VIEWER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "ticker" TEXT,
    "isin" TEXT,
    "exchange" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ipos" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "ipoName" TEXT NOT NULL,
    "issueOpenDate" DATE,
    "issueCloseDate" DATE,
    "listingDate" DATE,
    "issuePrice" DECIMAL(12,2),
    "listingPrice" DECIMAL(12,2),
    "issueSizeCr" DECIMAL(14,2),
    "status" "IpoStatus" NOT NULL DEFAULT 'LISTED',
    "isSampleData" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ipos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lock_in_events" (
    "id" TEXT NOT NULL,
    "ipoId" TEXT NOT NULL,
    "category" "LockInCategory" NOT NULL,
    "holderType" TEXT NOT NULL,
    "shares" BIGINT,
    "percentage" DECIMAL(6,3),
    "lockInPeriod" INTEGER,
    "periodUnit" "PeriodUnit",
    "startDate" DATE,
    "calculatedExpiryDate" DATE,
    "publishedExpiryDate" DATE,
    "finalExpiryDate" DATE,
    "calculationMethod" TEXT,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'NEEDS_REVIEW',
    "confidenceScore" INTEGER,
    "confidenceFactors" JSONB,
    "ruleText" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lock_in_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sources" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "tier" "SourceTier" NOT NULL,
    "priority" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "adapterKey" TEXT NOT NULL,
    "scrapeMethod" TEXT,
    "lastSuccessAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_records" (
    "id" TEXT NOT NULL,
    "lockInEventId" TEXT,
    "ipoId" TEXT,
    "sourceId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "documentTitle" TEXT,
    "publishedDate" DATE,
    "retrievedAt" TIMESTAMP(3) NOT NULL,
    "extractedValue" TEXT,
    "extractedText" TEXT,
    "parserConfidence" DECIMAL(4,3),
    "rawEvidence" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_results" (
    "id" TEXT NOT NULL,
    "lockInEventId" TEXT NOT NULL,
    "status" "VerificationStatus" NOT NULL,
    "recommendedDate" DATE,
    "confidenceScore" INTEGER NOT NULL,
    "factors" JSONB NOT NULL,
    "comparison" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manual_overrides" (
    "id" TEXT NOT NULL,
    "lockInEventId" TEXT NOT NULL,
    "overrideDate" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "analystName" TEXT NOT NULL,
    "userId" TEXT,
    "supportingSourceUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "manual_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_notes" (
    "id" TEXT NOT NULL,
    "lockInEventId" TEXT NOT NULL,
    "userId" TEXT,
    "authorName" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_runs" (
    "id" TEXT NOT NULL,
    "trigger" "SyncTrigger" NOT NULL DEFAULT 'MANUAL',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "status" "SyncStatus" NOT NULL DEFAULT 'RUNNING',
    "recordsFound" INTEGER NOT NULL DEFAULT 0,
    "recordsCreated" INTEGER NOT NULL DEFAULT 0,
    "recordsUpdated" INTEGER NOT NULL DEFAULT 0,
    "recordsFailed" INTEGER NOT NULL DEFAULT 0,
    "iposProcessed" INTEGER NOT NULL DEFAULT 0,
    "newIposFound" INTEGER NOT NULL DEFAULT 0,
    "discrepanciesDetected" INTEGER NOT NULL DEFAULT 0,
    "sourcesChecked" INTEGER NOT NULL DEFAULT 0,
    "sourcesFailed" INTEGER NOT NULL DEFAULT 0,
    "progress" JSONB,
    "triggeredBy" TEXT,

    CONSTRAINT "sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_errors" (
    "id" TEXT NOT NULL,
    "syncRunId" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "url" TEXT,
    "errorType" TEXT NOT NULL,
    "errorMessage" TEXT NOT NULL,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_errors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_config" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_config_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "companies_isin_key" ON "companies"("isin");

-- CreateIndex
CREATE INDEX "companies_ticker_idx" ON "companies"("ticker");

-- CreateIndex
CREATE INDEX "companies_name_idx" ON "companies"("name");

-- CreateIndex
CREATE INDEX "ipos_listingDate_idx" ON "ipos"("listingDate");

-- CreateIndex
CREATE INDEX "lock_in_events_finalExpiryDate_idx" ON "lock_in_events"("finalExpiryDate");

-- CreateIndex
CREATE INDEX "lock_in_events_verificationStatus_idx" ON "lock_in_events"("verificationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "sources_name_key" ON "sources"("name");

-- CreateIndex
CREATE INDEX "source_records_lockInEventId_idx" ON "source_records"("lockInEventId");

-- CreateIndex
CREATE INDEX "verification_results_lockInEventId_idx" ON "verification_results"("lockInEventId");

-- CreateIndex
CREATE INDEX "manual_overrides_lockInEventId_idx" ON "manual_overrides"("lockInEventId");

-- CreateIndex
CREATE INDEX "review_notes_lockInEventId_idx" ON "review_notes"("lockInEventId");

-- CreateIndex
CREATE INDEX "sync_runs_startedAt_idx" ON "sync_runs"("startedAt");

-- AddForeignKey
ALTER TABLE "ipos" ADD CONSTRAINT "ipos_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lock_in_events" ADD CONSTRAINT "lock_in_events_ipoId_fkey" FOREIGN KEY ("ipoId") REFERENCES "ipos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_lockInEventId_fkey" FOREIGN KEY ("lockInEventId") REFERENCES "lock_in_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_ipoId_fkey" FOREIGN KEY ("ipoId") REFERENCES "ipos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_results" ADD CONSTRAINT "verification_results_lockInEventId_fkey" FOREIGN KEY ("lockInEventId") REFERENCES "lock_in_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_overrides" ADD CONSTRAINT "manual_overrides_lockInEventId_fkey" FOREIGN KEY ("lockInEventId") REFERENCES "lock_in_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_overrides" ADD CONSTRAINT "manual_overrides_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_notes" ADD CONSTRAINT "review_notes_lockInEventId_fkey" FOREIGN KEY ("lockInEventId") REFERENCES "lock_in_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_notes" ADD CONSTRAINT "review_notes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_errors" ADD CONSTRAINT "sync_errors_syncRunId_fkey" FOREIGN KEY ("syncRunId") REFERENCES "sync_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
