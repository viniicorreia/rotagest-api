-- Row-Level Security (docs/ARCHITECTURE.md §5.7).
--
-- A API conecta como o papel rotagest_app (sem ser dono das tabelas) e, em
-- cada transação, informa a empresa ativa em app.company_id. As políticas
-- abaixo só deixam ler e gravar linhas dessa empresa. Rotas sem empresa
-- (login, onboarding, painel da plataforma, webhooks) ligam app.bypass.
-- Migrations, seed e scripts administrativos usam o dono do banco
-- (DIRECT_DATABASE_URL). Sem contexto informado, nenhuma linha é visível.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rotagest_app') THEN
    -- Sem LOGIN: a senha é definida fora das migrations (npm run db:app-role).
    CREATE ROLE rotagest_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO rotagest_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO rotagest_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO rotagest_app;
-- Tabelas criadas por migrations futuras (pelo mesmo dono) recebem as mesmas permissões.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO rotagest_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO rotagest_app;

-- A aplicação não mexe no histórico de migrations, e a auditoria só recebe inserções.
REVOKE ALL ON "_prisma_migrations" FROM rotagest_app;
REVOKE UPDATE, DELETE ON "audit_logs" FROM rotagest_app;

-- Empresas: cada uma só enxerga a própria linha.
ALTER TABLE "companies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "companies" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "companies"
  USING (current_setting('app.bypass', true) = 'on' OR "id" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (current_setting('app.bypass', true) = 'on' OR "id" = NULLIF(current_setting('app.company_id', true), '')::uuid);

-- Tabelas com companyId.
ALTER TABLE "account_transactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "account_transactions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "account_transactions"
  USING (current_setting('app.bypass', true) = 'on' OR "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (current_setting('app.bypass', true) = 'on' OR "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attachments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "attachments"
  USING (current_setting('app.bypass', true) = 'on' OR "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (current_setting('app.bypass', true) = 'on' OR "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "audit_logs"
  USING (current_setting('app.bypass', true) = 'on' OR "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (current_setting('app.bypass', true) = 'on' OR "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "billing_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "billing_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "billing_events"
  USING (current_setting('app.bypass', true) = 'on' OR "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (current_setting('app.bypass', true) = 'on' OR "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "company_invitations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "company_invitations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "company_invitations"
  USING (current_setting('app.bypass', true) = 'on' OR "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (current_setting('app.bypass', true) = 'on' OR "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "company_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "company_members" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "company_members"
  USING (current_setting('app.bypass', true) = 'on' OR "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (current_setting('app.bypass', true) = 'on' OR "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "contract_routes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contract_routes" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "contract_routes"
  USING (current_setting('app.bypass', true) = 'on' OR "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (current_setting('app.bypass', true) = 'on' OR "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "contract_vehicles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contract_vehicles" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "contract_vehicles"
  USING (current_setting('app.bypass', true) = 'on' OR "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (current_setting('app.bypass', true) = 'on' OR "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "contractors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contractors" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "contractors"
  USING (current_setting('app.bypass', true) = 'on' OR "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (current_setting('app.bypass', true) = 'on' OR "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "contracts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contracts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "contracts"
  USING (current_setting('app.bypass', true) = 'on' OR "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (current_setting('app.bypass', true) = 'on' OR "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "cost_centers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cost_centers" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "cost_centers"
  USING (current_setting('app.bypass', true) = 'on' OR "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (current_setting('app.bypass', true) = 'on' OR "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "drivers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "drivers" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "drivers"
  USING (current_setting('app.bypass', true) = 'on' OR "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (current_setting('app.bypass', true) = 'on' OR "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "expense_allocations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "expense_allocations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "expense_allocations"
  USING (current_setting('app.bypass', true) = 'on' OR "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (current_setting('app.bypass', true) = 'on' OR "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "financial_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "financial_accounts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "financial_accounts"
  USING (current_setting('app.bypass', true) = 'on' OR "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (current_setting('app.bypass', true) = 'on' OR "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "financial_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "financial_categories" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "financial_categories"
  USING (current_setting('app.bypass', true) = 'on' OR "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (current_setting('app.bypass', true) = 'on' OR "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "financial_transfers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "financial_transfers" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "financial_transfers"
  USING (current_setting('app.bypass', true) = 'on' OR "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (current_setting('app.bypass', true) = 'on' OR "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "fuel_expense_details" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fuel_expense_details" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "fuel_expense_details"
  USING (current_setting('app.bypass', true) = 'on' OR "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (current_setting('app.bypass', true) = 'on' OR "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "maintenances" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "maintenances" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "maintenances"
  USING (current_setting('app.bypass', true) = 'on' OR "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (current_setting('app.bypass', true) = 'on' OR "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "monthly_closings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "monthly_closings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "monthly_closings"
  USING (current_setting('app.bypass', true) = 'on' OR "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (current_setting('app.bypass', true) = 'on' OR "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "payables" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payables" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "payables"
  USING (current_setting('app.bypass', true) = 'on' OR "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (current_setting('app.bypass', true) = 'on' OR "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "receivables" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "receivables" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "receivables"
  USING (current_setting('app.bypass', true) = 'on' OR "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (current_setting('app.bypass', true) = 'on' OR "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "recurrence_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recurrence_rules" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "recurrence_rules"
  USING (current_setting('app.bypass', true) = 'on' OR "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (current_setting('app.bypass', true) = 'on' OR "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "revenue_allocations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "revenue_allocations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "revenue_allocations"
  USING (current_setting('app.bypass', true) = 'on' OR "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (current_setting('app.bypass', true) = 'on' OR "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "route_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "route_assignments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "route_assignments"
  USING (current_setting('app.bypass', true) = 'on' OR "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (current_setting('app.bypass', true) = 'on' OR "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "routes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "routes" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "routes"
  USING (current_setting('app.bypass', true) = 'on' OR "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (current_setting('app.bypass', true) = 'on' OR "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "settlements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "settlements" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "settlements"
  USING (current_setting('app.bypass', true) = 'on' OR "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (current_setting('app.bypass', true) = 'on' OR "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subscriptions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "subscriptions"
  USING (current_setting('app.bypass', true) = 'on' OR "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (current_setting('app.bypass', true) = 'on' OR "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "vehicle_daily_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vehicle_daily_logs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "vehicle_daily_logs"
  USING (current_setting('app.bypass', true) = 'on' OR "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (current_setting('app.bypass', true) = 'on' OR "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "vehicles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vehicles" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "vehicles"
  USING (current_setting('app.bypass', true) = 'on' OR "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (current_setting('app.bypass', true) = 'on' OR "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);
