/**
 * Tipos aceitos como comprovante, identificados pelos bytes iniciais do
 * arquivo (não pelo nome nem pelo Content-Type enviado pelo cliente).
 */
const SIGNATURES: { mime: string; ext: string; test: (b: Buffer) => boolean }[] = [
  { mime: 'application/pdf', ext: 'pdf', test: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  { mime: 'image/png', ext: 'png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/jpeg', ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/webp', ext: 'webp', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
];

export function detectFileType(buffer: Buffer): { mime: string; ext: string } | null {
  const found = SIGNATURES.find((s) => buffer.length >= 12 && s.test(buffer));
  return found ? { mime: found.mime, ext: found.ext } : null;
}

/** Nome exibido/baixado: sem caminho, sem caracteres de controle, tamanho limitado. */
export function safeFileName(name: string, ext: string): string {
  const base = (name.split(/[\\/]/).pop() ?? '').replace(/[\x00-\x1f\x7f"<>:|?*]/g, '').trim().slice(0, 120);
  if (!base) return `comprovante.${ext}`;
  return /\.[a-z0-9]{2,5}$/i.test(base) ? base : `${base}.${ext}`;
}
