-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('USER', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "CompanyStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CANCELED');

-- CreateEnum
CREATE TYPE "PersonType" AS ENUM ('INDIVIDUAL', 'COMPANY');

-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('OWNER', 'MANAGER', 'FINANCIAL', 'DRIVER');

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "BillingInterval" AS ENUM ('MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "VehicleStatus" AS ENUM ('ACTIVE', 'MAINTENANCE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('EMPLOYEE', 'CONTRACTOR', 'PARTNER', 'OTHER');

-- CreateEnum
CREATE TYPE "RecordStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "TransportType" AS ENUM ('SCHOOL', 'MUNICIPAL', 'CORPORATE', 'CHARTER', 'INTERCITY', 'OTHER');

-- CreateEnum
CREATE TYPE "ContractorKind" AS ENUM ('SCHOOL', 'CITY_HALL', 'PRIVATE_COMPANY', 'INDIVIDUAL', 'OTHER');

-- CreateEnum
CREATE TYPE "ContractBillingType" AS ENUM ('MONTHLY', 'FIXED_PERIOD', 'VARIABLE');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUSPENDED', 'ENDED', 'CANCELED');

-- CreateEnum
CREATE TYPE "MaintenanceType" AS ENUM ('PREVENTIVE', 'CORRECTIVE', 'OIL_CHANGE', 'TIRES', 'MECHANICAL', 'ELECTRICAL', 'OTHER');

-- CreateEnum
CREATE TYPE "FuelType" AS ENUM ('DIESEL', 'DIESEL_S10', 'GASOLINE', 'ETHANOL', 'CNG', 'OTHER');

-- CreateEnum
CREATE TYPE "FinancialAccountType" AS ENUM ('CHECKING', 'SAVINGS', 'CASH', 'OTHER');

-- CreateEnum
CREATE TYPE "CategoryType" AS ENUM ('INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "EntryKind" AS ENUM ('SINGLE', 'RECURRING', 'INSTALLMENT');

-- CreateEnum
CREATE TYPE "PayableStatus" AS ENUM ('PENDING', 'PARTIALLY_PAID', 'PAID', 'CANCELED');

-- CreateEnum
CREATE TYPE "ReceivableStatus" AS ENUM ('PENDING', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELED');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('APPROVED', 'PENDING_APPROVAL', 'REJECTED');

-- CreateEnum
CREATE TYPE "SettlementType" AS ENUM ('PAYMENT', 'RECEIPT');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('PIX', 'CASH', 'TRANSFER', 'DEPOSIT', 'BOLETO', 'CARD', 'OTHER');

-- CreateEnum
CREATE TYPE "TransactionDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "TransactionKind" AS ENUM ('OPENING_BALANCE', 'SETTLEMENT', 'TRANSFER', 'ADJUSTMENT', 'REVERSAL');

-- CreateEnum
CREATE TYPE "AllocationMethod" AS ENUM ('DIRECT', 'EQUAL', 'PERCENT', 'FIXED', 'REVENUE_PROPORTIONAL');

-- CreateEnum
CREATE TYPE "RecurrenceTarget" AS ENUM ('PAYABLE', 'RECEIVABLE');

-- CreateEnum
CREATE TYPE "RecurrenceFrequency" AS ENUM ('WEEKLY', 'MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "ClosingStatus" AS ENUM ('CLOSED', 'REOPENED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "platformRole" "PlatformRole" NOT NULL DEFAULT 'USER',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "activeCompanyId" UUID,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "rotatedAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL,
    "tradeName" TEXT NOT NULL,
    "legalName" TEXT,
    "personType" "PersonType" NOT NULL,
    "document" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" CHAR(2),
    "postalCode" TEXT,
    "status" "CompanyStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_members" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "MemberRole" NOT NULL,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "MemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deactivatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_invitations" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tokenHash" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "invitedById" UUID NOT NULL,
    "acceptedById" UUID,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'BRL',
    "interval" "BillingInterval" NOT NULL DEFAULT 'MONTHLY',
    "maxVehicles" INTEGER,
    "maxUsers" INTEGER,
    "status" "PlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_features" (
    "id" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "limit" INTEGER,

    CONSTRAINT "plan_features_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "trialEndsAt" TIMESTAMP(3),
    "currentPeriodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentPeriodEnd" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "overrideMaxVehicles" INTEGER,
    "overrideMaxUsers" INTEGER,
    "externalProvider" TEXT,
    "externalCustomerId" TEXT,
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "companyId" UUID,
    "actorUserId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "plate" TEXT NOT NULL,
    "brand" TEXT,
    "model" TEXT,
    "year" INTEGER,
    "odometerKm" INTEGER NOT NULL DEFAULT 0,
    "status" "VehicleStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drivers" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "document" TEXT NOT NULL,
    "phone" TEXT,
    "hiredAt" DATE,
    "employmentType" "EmploymentType" NOT NULL DEFAULT 'EMPLOYEE',
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "memberId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routes" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "transportType" "TransportType" NOT NULL DEFAULT 'SCHOOL',
    "region" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_assignments" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "routeId" UUID NOT NULL,
    "vehicleId" UUID,
    "driverId" UUID,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "route_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contractors" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ContractorKind" NOT NULL DEFAULT 'OTHER',
    "personType" "PersonType",
    "document" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contractors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "contractorId" UUID NOT NULL,
    "number" TEXT,
    "description" TEXT,
    "billingType" "ContractBillingType" NOT NULL DEFAULT 'MONTHLY',
    "amount" DECIMAL(14,2) NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "dueDay" INTEGER,
    "dueMonthOffset" INTEGER NOT NULL DEFAULT 1,
    "revenueCategoryId" UUID,
    "status" "ContractStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_vehicles" (
    "companyId" UUID NOT NULL,
    "contractId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "sharePercent" DECIMAL(9,6),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_vehicles_pkey" PRIMARY KEY ("contractId","vehicleId")
);

-- CreateTable
CREATE TABLE "contract_routes" (
    "companyId" UUID NOT NULL,
    "contractId" UUID NOT NULL,
    "routeId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_routes_pkey" PRIMARY KEY ("contractId","routeId")
);

-- CreateTable
CREATE TABLE "maintenances" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "type" "MaintenanceType" NOT NULL,
    "description" TEXT NOT NULL,
    "odometerKm" INTEGER,
    "date" DATE NOT NULL,
    "supplierName" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "notes" TEXT,
    "payableId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "maintenances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fuel_expense_details" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "payableId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "fuelType" "FuelType" NOT NULL DEFAULT 'DIESEL',
    "liters" DECIMAL(12,3) NOT NULL,
    "pricePerLiter" DECIMAL(12,4) NOT NULL,
    "odometerKm" INTEGER,
    "station" TEXT,
    "filledAt" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fuel_expense_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_accounts" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "FinancialAccountType" NOT NULL,
    "bankName" TEXT,
    "openingBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "openingBalanceDate" DATE NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_categories" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "type" "CategoryType" NOT NULL,
    "name" TEXT NOT NULL,
    "systemKey" TEXT,
    "parentId" UUID,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_centers" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cost_centers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurrence_rules" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "target" "RecurrenceTarget" NOT NULL,
    "frequency" "RecurrenceFrequency" NOT NULL DEFAULT 'MONTHLY',
    "interval" INTEGER NOT NULL DEFAULT 1,
    "dayOfMonth" INTEGER,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "maxOccurrences" INTEGER,
    "template" JSONB NOT NULL,
    "lastGeneratedDate" DATE,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurrence_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payables" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "categoryId" UUID NOT NULL,
    "costCenterId" UUID,
    "vehicleId" UUID,
    "routeId" UUID,
    "driverId" UUID,
    "supplierName" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "paidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "competence" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "status" "PayableStatus" NOT NULL DEFAULT 'PENDING',
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'APPROVED',
    "kind" "EntryKind" NOT NULL DEFAULT 'SINGLE',
    "installmentGroupId" UUID,
    "installmentNumber" INTEGER,
    "installmentCount" INTEGER,
    "recurrenceRuleId" UUID,
    "notes" TEXT,
    "canceledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receivables" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "categoryId" UUID NOT NULL,
    "contractId" UUID,
    "costCenterId" UUID,
    "amount" DECIMAL(14,2) NOT NULL,
    "receivedAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "competence" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "status" "ReceivableStatus" NOT NULL DEFAULT 'PENDING',
    "kind" "EntryKind" NOT NULL DEFAULT 'SINGLE',
    "installmentGroupId" UUID,
    "installmentNumber" INTEGER,
    "installmentCount" INTEGER,
    "recurrenceRuleId" UUID,
    "notes" TEXT,
    "canceledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "receivables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlements" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "type" "SettlementType" NOT NULL,
    "payableId" UUID,
    "receivableId" UUID,
    "accountId" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "settledAt" DATE NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "notes" TEXT,
    "reversedAt" TIMESTAMP(3),
    "reversalReason" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_transactions" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "kind" "TransactionKind" NOT NULL,
    "direction" "TransactionDirection" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "occurredAt" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "settlementId" UUID,
    "transferId" UUID,
    "reversesTransactionId" UUID,
    "reason" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_transfers" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "fromAccountId" UUID NOT NULL,
    "toAccountId" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "transferredAt" DATE NOT NULL,
    "description" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "reversedAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_allocations" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "payableId" UUID NOT NULL,
    "vehicleId" UUID,
    "routeId" UUID,
    "costCenterId" UUID,
    "method" "AllocationMethod" NOT NULL,
    "percent" DECIMAL(9,6),
    "amount" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revenue_allocations" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "receivableId" UUID NOT NULL,
    "vehicleId" UUID,
    "routeId" UUID,
    "contractId" UUID,
    "costCenterId" UUID,
    "method" "AllocationMethod" NOT NULL,
    "percent" DECIMAL(9,6),
    "amount" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revenue_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monthly_closings" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "status" "ClosingStatus" NOT NULL DEFAULT 'CLOSED',
    "snapshot" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedById" UUID NOT NULL,
    "reopenedAt" TIMESTAMP(3),
    "reopenedById" UUID,
    "reopenReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "monthly_closings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "payableId" UUID,
    "receivableId" UUID,
    "settlementId" UUID,
    "maintenanceId" UUID,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploadedById" UUID NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_sessions_tokenHash_key" ON "refresh_sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_sessions_userId_idx" ON "refresh_sessions"("userId");

-- CreateIndex
CREATE INDEX "refresh_sessions_familyId_idx" ON "refresh_sessions"("familyId");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_tokenHash_key" ON "password_reset_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_userId_idx" ON "password_reset_tokens"("userId");

-- CreateIndex
CREATE INDEX "companies_document_idx" ON "companies"("document");

-- CreateIndex
CREATE INDEX "companies_status_idx" ON "companies"("status");

-- CreateIndex
CREATE INDEX "company_members_userId_status_idx" ON "company_members"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "company_members_companyId_userId_key" ON "company_members"("companyId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "company_members_companyId_id_key" ON "company_members"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "company_invitations_tokenHash_key" ON "company_invitations"("tokenHash");

-- CreateIndex
CREATE INDEX "company_invitations_companyId_status_idx" ON "company_invitations"("companyId", "status");

-- CreateIndex
CREATE INDEX "company_invitations_email_status_idx" ON "company_invitations"("email", "status");

-- CreateIndex
CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");

-- CreateIndex
CREATE UNIQUE INDEX "plan_features_planId_key_key" ON "plan_features"("planId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_companyId_key" ON "subscriptions"("companyId");

-- CreateIndex
CREATE INDEX "subscriptions_status_idx" ON "subscriptions"("status");

-- CreateIndex
CREATE INDEX "audit_logs_companyId_createdAt_idx" ON "audit_logs"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_actorUserId_createdAt_idx" ON "audit_logs"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "vehicles_companyId_status_idx" ON "vehicles"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_companyId_id_key" ON "vehicles"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_companyId_plate_key" ON "vehicles"("companyId", "plate");

-- CreateIndex
CREATE INDEX "drivers_companyId_status_idx" ON "drivers"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "drivers_companyId_id_key" ON "drivers"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "drivers_companyId_document_key" ON "drivers"("companyId", "document");

-- CreateIndex
CREATE UNIQUE INDEX "drivers_companyId_memberId_key" ON "drivers"("companyId", "memberId");

-- CreateIndex
CREATE INDEX "routes_companyId_status_idx" ON "routes"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "routes_companyId_id_key" ON "routes"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "routes_companyId_name_key" ON "routes"("companyId", "name");

-- CreateIndex
CREATE INDEX "route_assignments_companyId_routeId_startDate_idx" ON "route_assignments"("companyId", "routeId", "startDate");

-- CreateIndex
CREATE INDEX "route_assignments_companyId_vehicleId_startDate_idx" ON "route_assignments"("companyId", "vehicleId", "startDate");

-- CreateIndex
CREATE INDEX "route_assignments_companyId_driverId_startDate_idx" ON "route_assignments"("companyId", "driverId", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "contractors_companyId_id_key" ON "contractors"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "contractors_companyId_document_key" ON "contractors"("companyId", "document");

-- CreateIndex
CREATE INDEX "contracts_companyId_status_idx" ON "contracts"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_companyId_id_key" ON "contracts"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_companyId_number_key" ON "contracts"("companyId", "number");

-- CreateIndex
CREATE INDEX "contract_vehicles_companyId_vehicleId_idx" ON "contract_vehicles"("companyId", "vehicleId");

-- CreateIndex
CREATE INDEX "contract_routes_companyId_routeId_idx" ON "contract_routes"("companyId", "routeId");

-- CreateIndex
CREATE INDEX "maintenances_companyId_vehicleId_date_idx" ON "maintenances"("companyId", "vehicleId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "maintenances_companyId_id_key" ON "maintenances"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "maintenances_companyId_payableId_key" ON "maintenances"("companyId", "payableId");

-- CreateIndex
CREATE INDEX "fuel_expense_details_companyId_vehicleId_filledAt_idx" ON "fuel_expense_details"("companyId", "vehicleId", "filledAt");

-- CreateIndex
CREATE UNIQUE INDEX "fuel_expense_details_companyId_payableId_key" ON "fuel_expense_details"("companyId", "payableId");

-- CreateIndex
CREATE UNIQUE INDEX "financial_accounts_companyId_id_key" ON "financial_accounts"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "financial_accounts_companyId_name_key" ON "financial_accounts"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "financial_categories_companyId_id_key" ON "financial_categories"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "financial_categories_companyId_type_name_key" ON "financial_categories"("companyId", "type", "name");

-- CreateIndex
CREATE UNIQUE INDEX "financial_categories_companyId_systemKey_key" ON "financial_categories"("companyId", "systemKey");

-- CreateIndex
CREATE UNIQUE INDEX "cost_centers_companyId_id_key" ON "cost_centers"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "cost_centers_companyId_name_key" ON "cost_centers"("companyId", "name");

-- CreateIndex
CREATE INDEX "recurrence_rules_companyId_status_idx" ON "recurrence_rules"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "recurrence_rules_companyId_id_key" ON "recurrence_rules"("companyId", "id");

-- CreateIndex
CREATE INDEX "payables_companyId_status_dueDate_idx" ON "payables"("companyId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "payables_companyId_competence_idx" ON "payables"("companyId", "competence");

-- CreateIndex
CREATE INDEX "payables_companyId_categoryId_idx" ON "payables"("companyId", "categoryId");

-- CreateIndex
CREATE INDEX "payables_companyId_vehicleId_idx" ON "payables"("companyId", "vehicleId");

-- CreateIndex
CREATE UNIQUE INDEX "payables_companyId_id_key" ON "payables"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "payables_recurrenceRuleId_competence_key" ON "payables"("recurrenceRuleId", "competence");

-- CreateIndex
CREATE UNIQUE INDEX "payables_installmentGroupId_installmentNumber_key" ON "payables"("installmentGroupId", "installmentNumber");

-- CreateIndex
CREATE INDEX "receivables_companyId_status_dueDate_idx" ON "receivables"("companyId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "receivables_companyId_competence_idx" ON "receivables"("companyId", "competence");

-- CreateIndex
CREATE UNIQUE INDEX "receivables_companyId_id_key" ON "receivables"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "receivables_contractId_competence_key" ON "receivables"("contractId", "competence");

-- CreateIndex
CREATE UNIQUE INDEX "receivables_recurrenceRuleId_competence_key" ON "receivables"("recurrenceRuleId", "competence");

-- CreateIndex
CREATE UNIQUE INDEX "receivables_installmentGroupId_installmentNumber_key" ON "receivables"("installmentGroupId", "installmentNumber");

-- CreateIndex
CREATE INDEX "settlements_companyId_settledAt_idx" ON "settlements"("companyId", "settledAt");

-- CreateIndex
CREATE INDEX "settlements_payableId_idx" ON "settlements"("payableId");

-- CreateIndex
CREATE INDEX "settlements_receivableId_idx" ON "settlements"("receivableId");

-- CreateIndex
CREATE UNIQUE INDEX "settlements_companyId_id_key" ON "settlements"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "settlements_companyId_idempotencyKey_key" ON "settlements"("companyId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "account_transactions_companyId_accountId_occurredAt_idx" ON "account_transactions"("companyId", "accountId", "occurredAt");

-- CreateIndex
CREATE INDEX "account_transactions_companyId_occurredAt_idx" ON "account_transactions"("companyId", "occurredAt");

-- CreateIndex
CREATE INDEX "account_transactions_settlementId_idx" ON "account_transactions"("settlementId");

-- CreateIndex
CREATE INDEX "account_transactions_transferId_idx" ON "account_transactions"("transferId");

-- CreateIndex
CREATE UNIQUE INDEX "account_transactions_reversesTransactionId_key" ON "account_transactions"("reversesTransactionId");

-- CreateIndex
CREATE INDEX "financial_transfers_companyId_transferredAt_idx" ON "financial_transfers"("companyId", "transferredAt");

-- CreateIndex
CREATE UNIQUE INDEX "financial_transfers_companyId_id_key" ON "financial_transfers"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "financial_transfers_companyId_idempotencyKey_key" ON "financial_transfers"("companyId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "expense_allocations_companyId_payableId_idx" ON "expense_allocations"("companyId", "payableId");

-- CreateIndex
CREATE INDEX "expense_allocations_companyId_vehicleId_idx" ON "expense_allocations"("companyId", "vehicleId");

-- CreateIndex
CREATE INDEX "expense_allocations_companyId_routeId_idx" ON "expense_allocations"("companyId", "routeId");

-- CreateIndex
CREATE INDEX "revenue_allocations_companyId_receivableId_idx" ON "revenue_allocations"("companyId", "receivableId");

-- CreateIndex
CREATE INDEX "revenue_allocations_companyId_vehicleId_idx" ON "revenue_allocations"("companyId", "vehicleId");

-- CreateIndex
CREATE INDEX "revenue_allocations_companyId_routeId_idx" ON "revenue_allocations"("companyId", "routeId");

-- CreateIndex
CREATE UNIQUE INDEX "monthly_closings_companyId_year_month_key" ON "monthly_closings"("companyId", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "attachments_storageKey_key" ON "attachments"("storageKey");

-- CreateIndex
CREATE INDEX "attachments_companyId_payableId_idx" ON "attachments"("companyId", "payableId");

-- CreateIndex
CREATE INDEX "attachments_companyId_receivableId_idx" ON "attachments"("companyId", "receivableId");

-- CreateIndex
CREATE INDEX "attachments_companyId_settlementId_idx" ON "attachments"("companyId", "settlementId");

-- CreateIndex
CREATE INDEX "attachments_companyId_maintenanceId_idx" ON "attachments"("companyId", "maintenanceId");

-- AddForeignKey
ALTER TABLE "refresh_sessions" ADD CONSTRAINT "refresh_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_members" ADD CONSTRAINT "company_members_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_members" ADD CONSTRAINT "company_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_invitations" ADD CONSTRAINT "company_invitations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_invitations" ADD CONSTRAINT "company_invitations_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_invitations" ADD CONSTRAINT "company_invitations_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_features" ADD CONSTRAINT "plan_features_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_companyId_memberId_fkey" FOREIGN KEY ("companyId", "memberId") REFERENCES "company_members"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_assignments" ADD CONSTRAINT "route_assignments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_assignments" ADD CONSTRAINT "route_assignments_companyId_routeId_fkey" FOREIGN KEY ("companyId", "routeId") REFERENCES "routes"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_assignments" ADD CONSTRAINT "route_assignments_companyId_vehicleId_fkey" FOREIGN KEY ("companyId", "vehicleId") REFERENCES "vehicles"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_assignments" ADD CONSTRAINT "route_assignments_companyId_driverId_fkey" FOREIGN KEY ("companyId", "driverId") REFERENCES "drivers"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contractors" ADD CONSTRAINT "contractors_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_companyId_contractorId_fkey" FOREIGN KEY ("companyId", "contractorId") REFERENCES "contractors"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_companyId_revenueCategoryId_fkey" FOREIGN KEY ("companyId", "revenueCategoryId") REFERENCES "financial_categories"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_vehicles" ADD CONSTRAINT "contract_vehicles_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_vehicles" ADD CONSTRAINT "contract_vehicles_companyId_contractId_fkey" FOREIGN KEY ("companyId", "contractId") REFERENCES "contracts"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_vehicles" ADD CONSTRAINT "contract_vehicles_companyId_vehicleId_fkey" FOREIGN KEY ("companyId", "vehicleId") REFERENCES "vehicles"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_routes" ADD CONSTRAINT "contract_routes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_routes" ADD CONSTRAINT "contract_routes_companyId_contractId_fkey" FOREIGN KEY ("companyId", "contractId") REFERENCES "contracts"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_routes" ADD CONSTRAINT "contract_routes_companyId_routeId_fkey" FOREIGN KEY ("companyId", "routeId") REFERENCES "routes"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenances" ADD CONSTRAINT "maintenances_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenances" ADD CONSTRAINT "maintenances_companyId_vehicleId_fkey" FOREIGN KEY ("companyId", "vehicleId") REFERENCES "vehicles"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenances" ADD CONSTRAINT "maintenances_companyId_payableId_fkey" FOREIGN KEY ("companyId", "payableId") REFERENCES "payables"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_expense_details" ADD CONSTRAINT "fuel_expense_details_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_expense_details" ADD CONSTRAINT "fuel_expense_details_companyId_payableId_fkey" FOREIGN KEY ("companyId", "payableId") REFERENCES "payables"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_expense_details" ADD CONSTRAINT "fuel_expense_details_companyId_vehicleId_fkey" FOREIGN KEY ("companyId", "vehicleId") REFERENCES "vehicles"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_categories" ADD CONSTRAINT "financial_categories_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_categories" ADD CONSTRAINT "financial_categories_companyId_parentId_fkey" FOREIGN KEY ("companyId", "parentId") REFERENCES "financial_categories"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurrence_rules" ADD CONSTRAINT "recurrence_rules_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payables" ADD CONSTRAINT "payables_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payables" ADD CONSTRAINT "payables_companyId_categoryId_fkey" FOREIGN KEY ("companyId", "categoryId") REFERENCES "financial_categories"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payables" ADD CONSTRAINT "payables_companyId_costCenterId_fkey" FOREIGN KEY ("companyId", "costCenterId") REFERENCES "cost_centers"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payables" ADD CONSTRAINT "payables_companyId_vehicleId_fkey" FOREIGN KEY ("companyId", "vehicleId") REFERENCES "vehicles"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payables" ADD CONSTRAINT "payables_companyId_routeId_fkey" FOREIGN KEY ("companyId", "routeId") REFERENCES "routes"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payables" ADD CONSTRAINT "payables_companyId_driverId_fkey" FOREIGN KEY ("companyId", "driverId") REFERENCES "drivers"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payables" ADD CONSTRAINT "payables_companyId_recurrenceRuleId_fkey" FOREIGN KEY ("companyId", "recurrenceRuleId") REFERENCES "recurrence_rules"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_companyId_categoryId_fkey" FOREIGN KEY ("companyId", "categoryId") REFERENCES "financial_categories"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_companyId_contractId_fkey" FOREIGN KEY ("companyId", "contractId") REFERENCES "contracts"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_companyId_costCenterId_fkey" FOREIGN KEY ("companyId", "costCenterId") REFERENCES "cost_centers"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_companyId_recurrenceRuleId_fkey" FOREIGN KEY ("companyId", "recurrenceRuleId") REFERENCES "recurrence_rules"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_companyId_payableId_fkey" FOREIGN KEY ("companyId", "payableId") REFERENCES "payables"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_companyId_receivableId_fkey" FOREIGN KEY ("companyId", "receivableId") REFERENCES "receivables"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_companyId_accountId_fkey" FOREIGN KEY ("companyId", "accountId") REFERENCES "financial_accounts"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_transactions" ADD CONSTRAINT "account_transactions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_transactions" ADD CONSTRAINT "account_transactions_companyId_accountId_fkey" FOREIGN KEY ("companyId", "accountId") REFERENCES "financial_accounts"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_transactions" ADD CONSTRAINT "account_transactions_companyId_settlementId_fkey" FOREIGN KEY ("companyId", "settlementId") REFERENCES "settlements"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_transactions" ADD CONSTRAINT "account_transactions_companyId_transferId_fkey" FOREIGN KEY ("companyId", "transferId") REFERENCES "financial_transfers"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_transactions" ADD CONSTRAINT "account_transactions_reversesTransactionId_fkey" FOREIGN KEY ("reversesTransactionId") REFERENCES "account_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_transfers" ADD CONSTRAINT "financial_transfers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_transfers" ADD CONSTRAINT "financial_transfers_companyId_fromAccountId_fkey" FOREIGN KEY ("companyId", "fromAccountId") REFERENCES "financial_accounts"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_transfers" ADD CONSTRAINT "financial_transfers_companyId_toAccountId_fkey" FOREIGN KEY ("companyId", "toAccountId") REFERENCES "financial_accounts"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_allocations" ADD CONSTRAINT "expense_allocations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_allocations" ADD CONSTRAINT "expense_allocations_companyId_payableId_fkey" FOREIGN KEY ("companyId", "payableId") REFERENCES "payables"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_allocations" ADD CONSTRAINT "expense_allocations_companyId_vehicleId_fkey" FOREIGN KEY ("companyId", "vehicleId") REFERENCES "vehicles"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_allocations" ADD CONSTRAINT "expense_allocations_companyId_routeId_fkey" FOREIGN KEY ("companyId", "routeId") REFERENCES "routes"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_allocations" ADD CONSTRAINT "expense_allocations_companyId_costCenterId_fkey" FOREIGN KEY ("companyId", "costCenterId") REFERENCES "cost_centers"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revenue_allocations" ADD CONSTRAINT "revenue_allocations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revenue_allocations" ADD CONSTRAINT "revenue_allocations_companyId_receivableId_fkey" FOREIGN KEY ("companyId", "receivableId") REFERENCES "receivables"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revenue_allocations" ADD CONSTRAINT "revenue_allocations_companyId_vehicleId_fkey" FOREIGN KEY ("companyId", "vehicleId") REFERENCES "vehicles"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revenue_allocations" ADD CONSTRAINT "revenue_allocations_companyId_routeId_fkey" FOREIGN KEY ("companyId", "routeId") REFERENCES "routes"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revenue_allocations" ADD CONSTRAINT "revenue_allocations_companyId_contractId_fkey" FOREIGN KEY ("companyId", "contractId") REFERENCES "contracts"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revenue_allocations" ADD CONSTRAINT "revenue_allocations_companyId_costCenterId_fkey" FOREIGN KEY ("companyId", "costCenterId") REFERENCES "cost_centers"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monthly_closings" ADD CONSTRAINT "monthly_closings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_companyId_payableId_fkey" FOREIGN KEY ("companyId", "payableId") REFERENCES "payables"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_companyId_receivableId_fkey" FOREIGN KEY ("companyId", "receivableId") REFERENCES "receivables"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_companyId_settlementId_fkey" FOREIGN KEY ("companyId", "settlementId") REFERENCES "settlements"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_companyId_maintenanceId_fkey" FOREIGN KEY ("companyId", "maintenanceId") REFERENCES "maintenances"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
