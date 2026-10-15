import { createHash, randomBytes } from 'node:crypto';

/** Token opaco com 256 bits de entropia, seguro para URL. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Hash usado para guardar tokens (refresh, convite, redefinição) sem o valor original. */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
