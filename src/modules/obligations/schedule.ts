import { addMonths, firstOfMonth, formatDate, splitInstallments, today } from '../../domain';

export interface Occurrence {
  competence: Date;
  dueDate: Date;
  amountCents: number;
  number?: number;
  count?: number;
}

/** Diferença em meses entre dois dias 1º (b − a). */
export function monthDiff(a: Date, b: Date): number {
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
}

/**
 * Parcelamento (ARCHITECTURE.md §6.9): n obrigações mensais, valor em centavos
 * com o arredondamento na última parcela, competência e vencimento avançando
 * um mês por parcela e preservando o dia do primeiro vencimento.
 */
export function installmentSchedule(totalCents: number, count: number, competence: Date, firstDue: Date): Occurrence[] {
  const parts = splitInstallments(totalCents, count);
  const day = firstDue.getUTCDate();
  return parts.map((amountCents, i) => ({
    competence: addMonths(competence, i, 1),
    dueDate: addMonths(firstDue, i, day),
    amountCents,
    number: i + 1,
    count,
  }));
}

export interface RecurrenceSpec {
  frequency: 'MONTHLY' | 'YEARLY';
  /** Primeira competência. */
  start: Date;
  /** Última competência permitida (inclusive), se houver. */
  end: Date | null;
  maxOccurrences: number | null;
  dueDay: number;
  dueMonthOffset: number;
}

/** Competência da ocorrência `index` (0 = primeira). */
export function recurrenceCompetence(spec: RecurrenceSpec, index: number): Date {
  return addMonths(spec.start, index * (spec.frequency === 'YEARLY' ? 12 : 1), 1);
}

export function recurrenceDueDate(spec: RecurrenceSpec, competence: Date): Date {
  return addMonths(competence, spec.dueMonthOffset, spec.dueDay);
}

/**
 * Ocorrências até o horizonte (competência ≤ `horizon`), respeitando fim e
 * número máximo. O gerador grava com unicidade (regra, competência), então
 * chamar de novo nunca duplica.
 */
export function recurrenceOccurrences(spec: RecurrenceSpec, horizon: Date): Date[] {
  const out: Date[] = [];
  for (let i = 0; ; i += 1) {
    if (spec.maxOccurrences !== null && i >= spec.maxOccurrences) break;
    const competence = recurrenceCompetence(spec, i);
    if (competence > horizon) break;
    if (spec.end && competence > spec.end) break;
    out.push(competence);
    if (i > 600) break;
  }
  return out;
}

/** Horizonte padrão do gerador: até a competência do mês que vem. */
export function defaultHorizon(now = today()): Date {
  return addMonths(firstOfMonth(now), 1, 1);
}

/** "Vencida" é derivada, nunca persistida (ARCHITECTURE.md §6.2). */
export function isOverdue(status: string, dueDate: Date, now = today()): boolean {
  return (status === 'PENDING' || status.startsWith('PARTIALLY')) && formatDate(dueDate) < formatDate(now);
}
