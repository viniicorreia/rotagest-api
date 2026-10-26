import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { formatMonth, toCents } from '../../domain';
import { PrismaService } from '../../prisma/prisma.service';

export interface VehicleMonthRow {
  vehicleId: string;
  month: string;
  revenueCents: number;
  directCostCents: number;
  sharedCostCents: number;
}

/**
 * Resultado gerencial por veículo (regime de competência, ARCHITECTURE.md §6.7):
 * receita = Σ RevenueAllocation; custo = Σ ExpenseAllocation, separando o que
 * foi lançado direto no veículo (DIRECT) do que veio de rateio. Obrigações
 * canceladas e despesas não aprovadas ficam de fora.
 */
@Injectable()
export class ResultsService {
  constructor(private readonly prisma: PrismaService) {}

  async vehicleMonths(companyId: string, from: Date, to: Date, vehicleId?: string, categoryId?: string): Promise<VehicleMonthRow[]> {
    const vehicleFilterRev = Prisma.sql`${vehicleId ? Prisma.sql`AND ra."vehicleId" = ${vehicleId}::uuid` : Prisma.empty} ${categoryId ? Prisma.sql`AND r."categoryId" = ${categoryId}::uuid` : Prisma.empty}`;
    const vehicleFilterExp = Prisma.sql`${vehicleId ? Prisma.sql`AND ea."vehicleId" = ${vehicleId}::uuid` : Prisma.empty} ${categoryId ? Prisma.sql`AND p."categoryId" = ${categoryId}::uuid` : Prisma.empty}`;
    const rows = await this.prisma.$queryRaw<{ vehicleId: string; month: Date; revenue: string; direct: string; shared: string }[]>`
      WITH rev AS (
        SELECT ra."vehicleId", r.competence AS month, SUM(ra.amount) AS amount
        FROM revenue_allocations ra
        JOIN receivables r ON r.id = ra."receivableId"
        WHERE ra."companyId" = ${companyId}::uuid AND ra."vehicleId" IS NOT NULL
          AND r.status <> 'CANCELED' AND r.competence BETWEEN ${from}::date AND ${to}::date ${vehicleFilterRev}
        GROUP BY 1, 2
      ), exp AS (
        SELECT ea."vehicleId", p.competence AS month,
               SUM(CASE WHEN ea.method = 'DIRECT' THEN ea.amount ELSE 0 END) AS direct,
               SUM(CASE WHEN ea.method <> 'DIRECT' THEN ea.amount ELSE 0 END) AS shared
        FROM expense_allocations ea
        JOIN payables p ON p.id = ea."payableId"
        WHERE ea."companyId" = ${companyId}::uuid AND ea."vehicleId" IS NOT NULL
          AND p.status <> 'CANCELED' AND p."approvalStatus" = 'APPROVED'
          AND p.competence BETWEEN ${from}::date AND ${to}::date ${vehicleFilterExp}
        GROUP BY 1, 2
      )
      SELECT COALESCE(rev."vehicleId", exp."vehicleId") AS "vehicleId",
             COALESCE(rev.month, exp.month) AS month,
             COALESCE(rev.amount, 0)::text AS revenue,
             COALESCE(exp.direct, 0)::text AS direct,
             COALESCE(exp.shared, 0)::text AS shared
      FROM rev FULL OUTER JOIN exp ON rev."vehicleId" = exp."vehicleId" AND rev.month = exp.month
      ORDER BY 2, 1`;
    return rows.map((r) => ({
      vehicleId: r.vehicleId,
      month: formatMonth(r.month),
      revenueCents: toCents(r.revenue),
      directCostCents: toCents(r.direct),
      sharedCostCents: toCents(r.shared),
    }));
  }
}
