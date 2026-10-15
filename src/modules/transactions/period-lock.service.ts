import { Injectable } from '@nestjs/common';
import { ErrorCode, conflict } from '../../common/errors';
import { formatMonth } from '../../domain';
import { PrismaService, type Tx } from '../../prisma/prisma.service';

/**
 * Bloqueio de período (ARCHITECTURE.md §6.10). Toda escrita financeira chama
 * `assertOpen` com a competência (obrigações) ou a data efetiva (liquidações,
 * transferências, ajustes). Mês com fechamento confirmado → 409 PERIOD_CLOSED.
 * O fechamento em si chega na Fase 4; a verificação já vale desde agora.
 */
@Injectable()
export class PeriodLockService {
  constructor(private readonly prisma: PrismaService) {}

  async assertOpen(companyId: string, dates: Date | Date[], tx?: Tx): Promise<void> {
    const list = Array.isArray(dates) ? dates : [dates];
    const months = [...new Map(list.map((d) => [formatMonth(d), { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 }])).values()];
    if (months.length === 0) return;
    const closed = await (tx ?? this.prisma).monthlyClosing.findFirst({
      where: { companyId, status: 'CLOSED', OR: months },
      select: { year: true, month: true },
    });
    if (closed) {
      const label = `${String(closed.month).padStart(2, '0')}/${closed.year}`;
      throw conflict(`O mês ${label} está fechado. Reabra o fechamento para alterar lançamentos desse período.`, ErrorCode.PERIOD_CLOSED);
    }
  }
}
