/**
 * Dinheiro em centavos inteiros. Toda conta financeira da API passa por aqui:
 * o banco guarda Decimal(14,2), a aplicação converte para centavos, calcula e
 * converte de volta. Nunca usar float para somar valores.
 */

/** Formato aceito na API: "1234.56" (até 12 dígitos inteiros, até 2 casas). */
export const MONEY_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;

/** Converte "1234.5", "1234.56" ou um Decimal do Prisma em centavos. */
export function toCents(value: string | number | { toFixed(dp: number): string }): number {
  const text = typeof value === 'object' ? value.toFixed(2) : typeof value === 'number' ? value.toFixed(2) : value.trim();
  const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new Error(`Valor monetário inválido: ${text}`);
  const cents = Number(match[2]) * 100 + Number((match[3] ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) throw new Error('Valor monetário fora do limite');
  return match[1] ? -cents : cents;
}

/** Centavos → "1234.56" (formato da API e do Decimal do Prisma). */
export function fromCents(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new Error('Centavos devem ser inteiros');
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/**
 * Divide `totalCents` em `n` partes iguais; o arredondamento vai para a ÚLTIMA
 * parte (regra de parcelamento: 1.000,00 em 3x → 333,33 + 333,33 + 333,34).
 */
export function splitInstallments(totalCents: number, n: number): number[] {
  if (!Number.isInteger(n) || n < 1) throw new Error('Número de parcelas inválido');
  const base = Math.floor(totalCents / n);
  const parts = Array.from({ length: n }, () => base);
  parts[n - 1] += totalCents - base * n;
  return parts;
}

/**
 * Distribui `totalCents` proporcionalmente a `weights` pelo método do maior
 * resto: a soma das partes é sempre exatamente o total. Empates no resto vão
 * para os primeiros pesos na ordem informada.
 */
export function allocateLargestRemainder(totalCents: number, weights: readonly number[]): number[] {
  if (weights.length === 0) throw new Error('Informe ao menos um destino');
  if (weights.some((w) => w < 0 || !Number.isFinite(w))) throw new Error('Pesos inválidos');
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) throw new Error('A soma dos pesos deve ser positiva');
  const exact = weights.map((w) => (totalCents * w) / sum);
  const parts = exact.map((x) => Math.floor(x));
  let rest = totalCents - parts.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (let k = 0; rest > 0; k = (k + 1) % order.length, rest -= 1) parts[order[k].i] += 1;
  return parts;
}
