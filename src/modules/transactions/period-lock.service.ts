import { Injectable } from '@nestjs/common';
import { ErrorCode, conflict } from '../../common/errors';
import { formatMonth } from '../../domain';
import { PrismaService, type Tx } from '../../prisma/prisma.service';

/**
 * Bloqueio de período (ARCHITECTURE.md §6.10). Toda escrita financeira chama
 * `assertOpen` com a competência (obrigações) ou a data efetiva (liquidações,
 * transferências, ajustes). Mês com fechamento confirmado → 409 PERIOD_CLOSED.
 *
 * Dentro de uma transação, segura também um lock compartilhado de cada mês
 * (o mesmo que o fechamento pega de forma exclusiva). Assim um lançamento em
 * andamento não escapa de um fechamento simultâneo: um espera o outro.
 */
@Injectable()
export class PeriodLockService {
  constructor(private readonly prisma: PrismaService) {}

  async assertOpen(companyId: string, dates: Date | Date[], tx?: Tx): Promise<void> {
    const list = Array.isArray(dates) ? dates : [dates];
    const months = [...new Map(list.map((d) => [formatMonth(d), { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 }])).values()];
    if (months.length === 0) return;
    if (tx) {
      // Ordem fixa evita deadlock entre lançamentos que tocam vários meses.
      for (const key of [...months.map((m) => `closing:${companyId}:${m.year}-${String(m.month).padStart(2, '0')}`)].sort()) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext(${key}))`;
      }
    }
    const closed = await (tx ?? this.prisma).monthlyClosing.findFirst({
      where: { companyId, status: 'CLOSED', OR: months },
      select: { year: true, month: true },
    });
    if (closed) {
      const label = `${String(closed.month).padStart(2, '0')}/${closed.year}`;
      throw conflict(`O mês ${label} está fechado. Reabra o fechamento para alterar lançamentos desse período.`, ErrorCode.PERIOD_CLOSED);
    }
  }

  /** Meses fechados ("AAAA-MM") entre as datas informadas. */
  async closedMonths(companyId: string, dates: Date[], tx?: Tx): Promise<Set<string>> {
    const months = [...new Map(dates.map((d) => [formatMonth(d), { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 }])).values()];
    if (months.length === 0) return new Set();
    const rows = await (tx ?? this.prisma).monthlyClosing.findMany({ where: { companyId, status: 'CLOSED', OR: months }, select: { year: true, month: true } });
    return new Set(rows.map((r) => `${r.year}-${String(r.month).padStart(2, '0')}`));
  }
}
