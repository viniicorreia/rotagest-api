import { toCents, fromCents } from '../../domain';

/**
 * Formato único de relatório: seções de tabela com colunas tipadas. A tela, o
 * PDF e o Excel leem o mesmo objeto, então os números exportados são sempre os
 * mesmos que a API calculou.
 */
export type ColumnType = 'text' | 'money' | 'number' | 'percent' | 'date' | 'month';
export type CellValue = string | number | null;

export interface ReportColumn {
  key: string;
  label: string;
  type: ColumnType;
  /** Soma na linha de totais (money e number). */
  sum?: boolean;
}

export interface ReportSection {
  title: string;
  columns: ReportColumn[];
  rows: Record<string, CellValue>[];
  totals: Record<string, CellValue> | null;
}

export interface ReportComparison {
  from: string;
  to: string;
  /** Totais da primeira seção no período anterior de mesmo tamanho. */
  totals: Record<string, CellValue>;
}

export interface Report {
  key: string;
  title: string;
  /** CASH = pela data efetiva; ACCRUAL = competência gerencial; DUE = pelo vencimento. */
  regime: 'CASH' | 'ACCRUAL' | 'DUE' | 'OPERATIONAL';
  from: string;
  to: string;
  filters: Record<string, string>;
  sections: ReportSection[];
  notes: string[];
  comparison: ReportComparison | null;
}

/** Monta a seção somando, em centavos, as colunas marcadas com `sum`. */
export function section(title: string, columns: ReportColumn[], rows: Record<string, CellValue>[], totalLabel = 'Total'): ReportSection {
  const summed = columns.filter((c) => c.sum);
  if (summed.length === 0 || rows.length === 0) return { title, columns, rows, totals: null };
  const totals: Record<string, CellValue> = {};
  for (const c of summed) {
    if (c.type === 'money') totals[c.key] = fromCents(rows.reduce((a, r) => a + (r[c.key] == null ? 0 : toCents(String(r[c.key]))), 0));
    else totals[c.key] = rows.reduce((a, r) => a + Number(r[c.key] ?? 0), 0);
  }
  const first = columns.find((c) => c.type === 'text' || c.type === 'month' || c.type === 'date');
  if (first && !(first.key in totals)) totals[first.key] = totalLabel;
  return { title, columns, rows, totals };
}

/** Participação em % com 2 casas, a partir de centavos ("12.34"); null sem base. */
export function share(part: number, whole: number): string | null {
  if (whole === 0) return null;
  const sign = part * whole < 0 ? -1 : 1;
  const hundredths = Math.floor((Math.abs(part) * 10_000 + Math.floor(Math.abs(whole) / 2)) / Math.abs(whole));
  const v = sign * hundredths;
  const abs = Math.abs(v);
  return `${v < 0 ? '-' : ''}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
