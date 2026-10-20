import { formatDate, formatMonth } from '../domain';

/** Decimal do Prisma (ou centavos já calculados) → "1234.56" na resposta da API. */
export function money(value: { toFixed(dp: number): string } | null | undefined): string {
  return value ? value.toFixed(2) : '0.00';
}

/** Coluna DATE → "AAAA-MM-DD". */
export function dateOnly(value: Date): string;
export function dateOnly(value: Date | null): string | null;
export function dateOnly(value: Date | null): string | null {
  return value ? formatDate(value) : null;
}

/** Competência (1º dia do mês) → "AAAA-MM". */
export function month(value: Date): string {
  return formatMonth(value);
}
