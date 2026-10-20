-- AlterTable
ALTER TABLE "vehicles" ADD COLUMN     "ratePerKm" DECIMAL(10,4);

-- CreateTable
CREATE TABLE "vehicle_daily_logs" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "kmDriven" DECIMAL(10,1) NOT NULL,
    "odometerStart" INTEGER,
    "odometerEnd" INTEGER,
    "ratePerKm" DECIMAL(10,4),
    "amount" DECIMAL(14,2),
    "driverId" UUID,
    "routeId" UUID,
    "receivableId" UUID,
    "notes" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_daily_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vehicle_daily_logs_companyId_date_idx" ON "vehicle_daily_logs"("companyId", "date");

-- CreateIndex
CREATE INDEX "vehicle_daily_logs_companyId_receivableId_idx" ON "vehicle_daily_logs"("companyId", "receivableId");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_daily_logs_companyId_id_key" ON "vehicle_daily_logs"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_daily_logs_companyId_vehicleId_date_key" ON "vehicle_daily_logs"("companyId", "vehicleId", "date");

-- AddForeignKey
ALTER TABLE "vehicle_daily_logs" ADD CONSTRAINT "vehicle_daily_logs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_daily_logs" ADD CONSTRAINT "vehicle_daily_logs_companyId_vehicleId_fkey" FOREIGN KEY ("companyId", "vehicleId") REFERENCES "vehicles"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_daily_logs" ADD CONSTRAINT "vehicle_daily_logs_companyId_driverId_fkey" FOREIGN KEY ("companyId", "driverId") REFERENCES "drivers"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_daily_logs" ADD CONSTRAINT "vehicle_daily_logs_companyId_routeId_fkey" FOREIGN KEY ("companyId", "routeId") REFERENCES "routes"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_daily_logs" ADD CONSTRAINT "vehicle_daily_logs_companyId_receivableId_fkey" FOREIGN KEY ("companyId", "receivableId") REFERENCES "receivables"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Restrições que o Prisma não expressa (ver migration integrity_constraints).
ALTER TABLE "vehicles"
  ADD CONSTRAINT "vehicles_rate_per_km_chk" CHECK ("ratePerKm" IS NULL OR "ratePerKm" >= 0);

ALTER TABLE "vehicle_daily_logs"
  ADD CONSTRAINT "vehicle_daily_logs_km_chk" CHECK ("kmDriven" >= 0 AND "kmDriven" <= 5000),
  ADD CONSTRAINT "vehicle_daily_logs_odometer_chk" CHECK (
    ("odometerStart" IS NULL AND "odometerEnd" IS NULL) OR
    ("odometerStart" IS NOT NULL AND "odometerEnd" IS NOT NULL AND "odometerEnd" >= "odometerStart" AND "odometerStart" >= 0)
  ),
  ADD CONSTRAINT "vehicle_daily_logs_amount_chk" CHECK (
    ("ratePerKm" IS NULL AND "amount" IS NULL) OR ("ratePerKm" >= 0 AND "amount" >= 0)
  );
