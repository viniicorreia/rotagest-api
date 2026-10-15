-- =============================================================================
-- Restrições de integridade que o Prisma não expressa no schema.
-- O Prisma ignora CHECKs e triggers ao gerar diffs, portanto elas permanecem
-- estáveis entre migrations futuras. Ver docs/ARCHITECTURE.md §4.4.
-- =============================================================================

-- ---------- SaaS ----------
ALTER TABLE "users"
  ADD CONSTRAINT "users_email_lowercase_chk" CHECK ("email" = lower("email"));

ALTER TABLE "companies"
  ADD CONSTRAINT "companies_document_chk" CHECK (
    ("personType" = 'INDIVIDUAL' AND "document" ~ '^[0-9]{11}$') OR
    ("personType" = 'COMPANY'    AND "document" ~ '^[0-9]{14}$')
  );

ALTER TABLE "plans"
  ADD CONSTRAINT "plans_price_chk" CHECK ("price" >= 0),
  ADD CONSTRAINT "plans_limits_chk" CHECK (
    ("maxVehicles" IS NULL OR "maxVehicles" >= 0) AND ("maxUsers" IS NULL OR "maxUsers" >= 1)
  );

-- Trilha de auditoria append-only.
CREATE OR REPLACE FUNCTION rotagest_forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Tabela % é append-only: % não permitido', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_logs_append_only"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION rotagest_forbid_mutation();

-- ---------- Transporte ----------
ALTER TABLE "vehicles"
  ADD CONSTRAINT "vehicles_year_chk" CHECK ("year" IS NULL OR "year" BETWEEN 1950 AND 2100),
  ADD CONSTRAINT "vehicles_odometer_chk" CHECK ("odometerKm" >= 0);

ALTER TABLE "route_assignments"
  ADD CONSTRAINT "route_assignments_dates_chk" CHECK ("endDate" IS NULL OR "endDate" >= "startDate"),
  ADD CONSTRAINT "route_assignments_target_chk" CHECK (num_nonnulls("vehicleId", "driverId") >= 1);

ALTER TABLE "contracts"
  ADD CONSTRAINT "contracts_amount_chk" CHECK ("amount" >= 0),
  ADD CONSTRAINT "contracts_due_day_chk" CHECK ("dueDay" IS NULL OR "dueDay" BETWEEN 1 AND 31),
  ADD CONSTRAINT "contracts_due_offset_chk" CHECK ("dueMonthOffset" BETWEEN 0 AND 12),
  ADD CONSTRAINT "contracts_dates_chk" CHECK ("endDate" IS NULL OR "endDate" >= "startDate");

ALTER TABLE "contract_vehicles"
  ADD CONSTRAINT "contract_vehicles_share_chk" CHECK ("sharePercent" IS NULL OR "sharePercent" BETWEEN 0 AND 100);

ALTER TABLE "maintenances"
  ADD CONSTRAINT "maintenances_amount_chk" CHECK ("amount" >= 0);

ALTER TABLE "fuel_expense_details"
  ADD CONSTRAINT "fuel_liters_chk" CHECK ("liters" > 0),
  ADD CONSTRAINT "fuel_price_chk" CHECK ("pricePerLiter" > 0);

-- ---------- Financeiro ----------
ALTER TABLE "payables"
  ADD CONSTRAINT "payables_amount_chk" CHECK ("amount" > 0),
  ADD CONSTRAINT "payables_paid_chk" CHECK ("paidAmount" >= 0 AND "paidAmount" <= "amount"),
  ADD CONSTRAINT "payables_competence_chk" CHECK (EXTRACT(DAY FROM "competence") = 1),
  ADD CONSTRAINT "payables_installment_chk" CHECK (
    ("kind" <> 'INSTALLMENT') OR
    ("installmentGroupId" IS NOT NULL AND "installmentNumber" BETWEEN 1 AND "installmentCount")
  );

ALTER TABLE "receivables"
  ADD CONSTRAINT "receivables_amount_chk" CHECK ("amount" > 0),
  ADD CONSTRAINT "receivables_received_chk" CHECK ("receivedAmount" >= 0 AND "receivedAmount" <= "amount"),
  ADD CONSTRAINT "receivables_competence_chk" CHECK (EXTRACT(DAY FROM "competence") = 1),
  ADD CONSTRAINT "receivables_installment_chk" CHECK (
    ("kind" <> 'INSTALLMENT') OR
    ("installmentGroupId" IS NOT NULL AND "installmentNumber" BETWEEN 1 AND "installmentCount")
  );

ALTER TABLE "settlements"
  ADD CONSTRAINT "settlements_amount_chk" CHECK ("amount" > 0),
  ADD CONSTRAINT "settlements_owner_chk" CHECK (
    ("type" = 'PAYMENT' AND "payableId" IS NOT NULL AND "receivableId" IS NULL) OR
    ("type" = 'RECEIPT' AND "receivableId" IS NOT NULL AND "payableId" IS NULL)
  );

ALTER TABLE "account_transactions"
  ADD CONSTRAINT "account_transactions_amount_chk" CHECK ("amount" > 0),
  ADD CONSTRAINT "account_transactions_origin_chk" CHECK (
    ("kind" = 'SETTLEMENT' AND "settlementId" IS NOT NULL) OR
    ("kind" = 'TRANSFER'   AND "transferId"   IS NOT NULL) OR
    ("kind" = 'REVERSAL'   AND "reversesTransactionId" IS NOT NULL) OR
    ("kind" IN ('OPENING_BALANCE', 'ADJUSTMENT'))
  );

-- O razão é imutável: correções são feitas por estorno (REVERSAL).
-- Exceção controlada: a transação OPENING_BALANCE pode ter valor/data
-- ajustados enquanto o período não estiver fechado (validado na aplicação).
CREATE OR REPLACE FUNCTION rotagest_ledger_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'account_transactions é imutável: DELETE não permitido'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD."kind" <> 'OPENING_BALANCE' OR NEW."kind" <> 'OPENING_BALANCE'
     OR NEW."accountId" <> OLD."accountId" OR NEW."companyId" <> OLD."companyId" THEN
    RAISE EXCEPTION 'account_transactions é imutável: use estorno (REVERSAL)'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "account_transactions_immutable"
  BEFORE UPDATE OR DELETE ON "account_transactions"
  FOR EACH ROW EXECUTE FUNCTION rotagest_ledger_guard();

-- Um único saldo inicial por conta.
CREATE UNIQUE INDEX "account_transactions_one_opening_balance"
  ON "account_transactions" ("accountId") WHERE "kind" = 'OPENING_BALANCE';

ALTER TABLE "financial_transfers"
  ADD CONSTRAINT "financial_transfers_amount_chk" CHECK ("amount" > 0),
  ADD CONSTRAINT "financial_transfers_distinct_chk" CHECK ("fromAccountId" <> "toAccountId");

ALTER TABLE "expense_allocations"
  ADD CONSTRAINT "expense_allocations_amount_chk" CHECK ("amount" >= 0),
  ADD CONSTRAINT "expense_allocations_percent_chk" CHECK ("percent" IS NULL OR "percent" BETWEEN 0 AND 100),
  ADD CONSTRAINT "expense_allocations_target_chk" CHECK (num_nonnulls("vehicleId", "routeId", "costCenterId") >= 1);

ALTER TABLE "revenue_allocations"
  ADD CONSTRAINT "revenue_allocations_amount_chk" CHECK ("amount" >= 0),
  ADD CONSTRAINT "revenue_allocations_percent_chk" CHECK ("percent" IS NULL OR "percent" BETWEEN 0 AND 100),
  ADD CONSTRAINT "revenue_allocations_target_chk" CHECK (num_nonnulls("vehicleId", "routeId", "contractId", "costCenterId") >= 1);

ALTER TABLE "monthly_closings"
  ADD CONSTRAINT "monthly_closings_month_chk" CHECK ("month" BETWEEN 1 AND 12),
  ADD CONSTRAINT "monthly_closings_year_chk" CHECK ("year" BETWEEN 2000 AND 2100),
  ADD CONSTRAINT "monthly_closings_reopen_chk" CHECK (
    "status" <> 'REOPENED' OR ("reopenReason" IS NOT NULL AND length(trim("reopenReason")) >= 10)
  );

ALTER TABLE "attachments"
  ADD CONSTRAINT "attachments_owner_chk" CHECK (
    num_nonnulls("payableId", "receivableId", "settlementId", "maintenanceId") = 1
  ),
  ADD CONSTRAINT "attachments_size_chk" CHECK ("sizeBytes" > 0);
