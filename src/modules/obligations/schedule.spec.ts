import { formatDate, parseDate, parseMonth } from '../../domain';
import { installmentSchedule, isOverdue, recurrenceOccurrences } from './schedule';

describe('cronogramas de obrigações', () => {
  it('parcela 1.000,00 em 3x com vencimentos mensais e resto na última', () => {
    const s = installmentSchedule(100_000, 3, parseMonth('2026-01'), parseDate('2026-01-31'));
    expect(s.map((o) => o.amountCents)).toEqual([33_333, 33_333, 33_334]);
    expect(s.map((o) => formatDate(o.dueDate))).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    expect(s.map((o) => formatDate(o.competence))).toEqual(['2026-01-01', '2026-02-01', '2026-03-01']);
  });

  it('gera recorrência mensal até o horizonte, respeitando fim e máximo', () => {
    const spec = { frequency: 'MONTHLY' as const, start: parseMonth('2026-08'), end: null, maxOccurrences: null, dueDay: 10, dueMonthOffset: 0 };
    expect(recurrenceOccurrences(spec, parseMonth('2026-11')).map((d) => formatDate(d).slice(0, 7))).toEqual(['2026-08', '2026-09', '2026-10', '2026-11']);
    expect(recurrenceOccurrences({ ...spec, maxOccurrences: 2 }, parseMonth('2026-11'))).toHaveLength(2);
    expect(recurrenceOccurrences({ ...spec, end: parseMonth('2026-09') }, parseMonth('2026-11'))).toHaveLength(2);
    expect(recurrenceOccurrences({ ...spec, frequency: 'YEARLY' }, parseMonth('2028-01'))).toHaveLength(2);
  });

  it('vencida é derivada do vencimento e do saldo em aberto', () => {
    const now = parseDate('2026-10-15');
    expect(isOverdue('PENDING', parseDate('2026-10-14'), now)).toBe(true);
    expect(isOverdue('PARTIALLY_PAID', parseDate('2026-10-14'), now)).toBe(true);
    expect(isOverdue('PENDING', parseDate('2026-10-15'), now)).toBe(false);
    expect(isOverdue('PAID', parseDate('2026-01-01'), now)).toBe(false);
  });
});
