/**
 * Quilometragem e faturamento por km, em inteiros (sem float):
 * km em décimos (123.4 km → 1234) e taxa em décimos de milésimo de real
 * (R$ 3,5 /km → 35000). Valor em centavos = km × taxa, arredondado
 * meio-para-cima no centavo.
 */

/** km rodados no dia: até 4 dígitos e 1 casa ("320", "87.5"). */
export const KM_PATTERN = /^\d{1,4}(\.\d)?$/;
/** R$/km: até 6 dígitos e 4 casas ("3.5", "2.8750"). */
export const RATE_PATTERN = /^\d{1,6}(\.\d{1,4})?$/;
/** Limite de sanidade para um dia de um veículo (o banco tem o mesmo CHECK). */
export const MAX_KM_PER_DAY = 5000;

function toScaled(value: string | number | { toFixed(dp: number): string }, decimals: number): number {
  const text = typeof value === 'object' ? value.toFixed(decimals) : typeof value === 'number' ? value.toFixed(decimals) : value.trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match || (match[2] && match[2].length > decimals)) throw new Error(`Número inválido: ${text}`);
  const n = Number(match[1]) * 10 ** decimals + Number((match[2] ?? '').padEnd(decimals, '0'));
  if (!Number.isSafeInteger(n)) throw new Error('Número fora do limite');
  return n;
}

function fromScaled(n: number, decimals: number): string {
  const base = 10 ** decimals;
  return `${Math.trunc(n / base)}.${String(n % base).padStart(decimals, '0')}`;
}

/** "123.4" → 1234 (décimos de km). */
export const toKmTenths = (value: string | number | { toFixed(dp: number): string }) => toScaled(value, 1);
/** 1234 → "123.4". */
export const fromKmTenths = (tenths: number) => fromScaled(tenths, 1);
/** "3.5" → 35000 (1/10000 de real). */
export const toRateUnits = (value: string | number | { toFixed(dp: number): string }) => toScaled(value, 4);

/** Taxa para a API: "3.50", "2.875" (mínimo 2 casas, sem zeros sobrando). */
export function formatRate(units: number): string {
  const full = fromScaled(units, 4);
  return full.replace(/0{1,2}$/, '');
}

/** Valor do dia em centavos: km × taxa, arredondado ao centavo (meio para cima). */
export function kmAmountCents(kmTenths: number, rateUnits: number): number {
  // (km/10) × (taxa/10000) × 100 centavos = km × taxa / 1000
  const raw = kmTenths * rateUnits;
  if (!Number.isSafeInteger(raw)) throw new Error('Valor fora do limite');
  return Math.floor((raw + 500) / 1000);
}

/** Litros abastecidos: até 5 dígitos e 3 casas ("45.320"). */
export const LITERS_PATTERN = /^\d{1,5}(\.\d{1,3})?$/;
/** Preço por litro: até 3 dígitos e 4 casas ("6.0990"). */
export const PRICE_PER_LITER_PATTERN = /^\d{1,3}(\.\d{1,4})?$/;

/** "45.32" → 45320 (mililitros). */
export const toMilliliters = (value: string | number | { toFixed(dp: number): string }) => toScaled(value, 3);
export const fromMilliliters = (ml: number) => fromScaled(ml, 3);

/** Total do abastecimento em centavos: litros × preço, arredondado ao centavo (meio para cima). */
export function fuelAmountCents(milliliters: number, priceUnits: number): number {
  // (ml/1000) × (preço/10000) × 100 centavos = ml × preço / 100000
  const raw = BigInt(milliliters) * BigInt(priceUnits);
  return Number((raw + 50_000n) / 100_000n);
}

/** km/l com 2 casas ("8.53"); null sem litros. */
export function kmPerLiter(kmTenths: number, milliliters: number): string | null {
  if (milliliters <= 0) return null;
  // (km/10) / (ml/1000) = km×100/ml; ×100 para 2 casas, arredondado.
  const hundredths = Math.floor((kmTenths * 10_000 + Math.floor(milliliters / 2)) / milliliters);
  return fromScaled(hundredths, 2);
}

/** Custo por km em centavos de real com 4 casas ("1.2345" = R$ 1,2345/km); null sem km. */
export function costPerKm(cents: number, kmTenths: number): string | null {
  if (kmTenths <= 0) return null;
  // (cents/100) / (km/10) = cents/(10×km); 4 casas → cents×1000/km
  const units = Math.floor((cents * 1000 + Math.floor(kmTenths / 2)) / kmTenths);
  return fromScaled(units, 4);
}
