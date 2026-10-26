-- Fase 6: acesso de suporte com consentimento do dono e exclusão de conta (LGPD).

-- AlterTable
ALTER TABLE "drivers" ADD COLUMN     "anonymizedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "anonymizedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "support_grants" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "grantedById" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "support_grants_companyId_expiresAt_idx" ON "support_grants"("companyId", "expiresAt");

-- AddForeignKey
ALTER TABLE "support_grants" ADD CONSTRAINT "support_grants_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_grants" ADD CONSTRAINT "support_grants_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_grants" ADD CONSTRAINT "support_grants_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Prazo máximo de 72 h e justificativa obrigatória.
ALTER TABLE "support_grants" ADD CONSTRAINT "support_grants_window_check"
  CHECK ("expiresAt" > "createdAt" AND "expiresAt" <= "createdAt" + interval '72 hours');
ALTER TABLE "support_grants" ADD CONSTRAINT "support_grants_reason_check"
  CHECK (char_length("reason") BETWEEN 10 AND 500);

-- Mesmo isolamento por empresa das demais tabelas (§5.7).
ALTER TABLE "support_grants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "support_grants" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "support_grants"
  USING (current_setting('app.bypass', true) = 'on' OR "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (current_setting('app.bypass', true) = 'on' OR "companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);
