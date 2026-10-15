/** Placa brasileira: antiga (ABC1234) ou Mercosul (ABC1D23), guardada sem hífen e em maiúsculas. */
export const PLATE_PATTERN = /^[A-Z]{3}\d[A-Z0-9]\d{2}$/;

export function normalizePlate(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isValidPlate(value: string): boolean {
  return PLATE_PATTERN.test(normalizePlate(value));
}
