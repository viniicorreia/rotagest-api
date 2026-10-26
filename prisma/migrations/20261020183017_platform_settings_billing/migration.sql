-- CreateTable
CREATE TABLE "platform_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "allowNewCompanies" BOOLEAN NOT NULL DEFAULT true,
    "defaultPlanId" UUID,
    "trialDays" INTEGER NOT NULL DEFAULT 14,
    "supportEmail" TEXT,
    "updatedById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_events" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "companyId" UUID,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "billing_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "billing_events_companyId_receivedAt_idx" ON "billing_events"("companyId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "billing_events_provider_externalId_key" ON "billing_events"("provider", "externalId");

-- AddForeignKey
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_defaultPlanId_fkey" FOREIGN KEY ("defaultPlanId") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_events" ADD CONSTRAINT "billing_events_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Linha única e valores válidos
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_single_row" CHECK ("id" = 1);
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_trial_days" CHECK ("trialDays" BETWEEN 0 AND 90);

