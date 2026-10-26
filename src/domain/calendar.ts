/**
 * Datas de negócio (vencimento, competência, data efetiva) são DATE, sem fuso.
 * Na aplicação elas trafegam como "YYYY-MM-DD" e, em memória, como Date à
 * meia-noite UTC — exatamente como o Prisma lê/grava colunas @db.Date.
 */

export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Fuso usado para decidir "hoje" (vencida, data máxima de liquidação). */
export const BUSINESS_TIME_ZONE = 'America/Sao_Paulo';

export function parseDate(value: string): Date {
  if (!DATE_PATTERN.test(value)) throw new Error(`Data inválida: ${value}`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || formatDate(date) !== value) throw new Error(`Data inválida: ${value}`);
  return date;
}

export function isValidDate(value: string): boolean {
  try {
    parseDate(value);
    return true;
  } catch {
    return false;
  }
}

export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** "2026-10" → Date de 2026-10-01. */
export function parseMonth(value: string): Date {
  if (!MONTH_PATTERN.test(value)) throw new Error(`Competência inválida: ${value}`);
  return new Date(`${value}-01T00:00:00.000Z`);
}

export function formatMonth(date: Date): string {
  return date.toISOString().slice(0, 7);
}

export function firstOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

export function lastOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

/**
 * Soma meses mantendo o dia, limitado ao último dia do mês de destino
 * (31/01 + 1 mês = 28/02 ou 29/02). `preferredDay` preserva o dia original
 * em séries (31/01 → 28/02 → 31/03).
 */
export function addMonths(date: Date, months: number, preferredDay = date.getUTCDate()): Date {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const last = lastOfMonth(target).getUTCDate();
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(preferredDay, last)));
}

/** Data de hoje no fuso do negócio, como Date à meia-noite UTC. */
export function today(now: Date = new Date(), timeZone = BUSINESS_TIME_ZONE): Date {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return parseDate(parts);
}

/** Lista de competências (1º dia) de `from` até `to`, inclusive. */
export function monthsBetween(from: Date, to: Date): Date[] {
  const out: Date[] = [];
  for (let d = firstOfMonth(from); d <= to; d = addMonths(d, 1, 1)) out.push(d);
  return out;
}
