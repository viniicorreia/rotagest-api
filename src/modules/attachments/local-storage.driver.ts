import { createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import type { StorageDriver } from './storage.service';

/** Disco local, numa pasta que nunca é servida estaticamente (STORAGE_DIR). */
export class LocalStorageDriver implements StorageDriver {
  private readonly root: string;

  constructor(dir: string) {
    this.root = resolve(dir);
  }

  /** Resolve a chave dentro da raiz, recusando qualquer tentativa de sair dela. */
  private pathFor(key: string): string {
    const full = resolve(this.root, key);
    if (!full.startsWith(this.root + sep)) throw new Error('Chave de armazenamento inválida');
    return full;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const full = this.pathFor(key);
    await mkdir(dirname(full), { recursive: true, mode: 0o700 });
    await writeFile(full, data, { mode: 0o600, flag: 'wx' });
  }

  async read(key: string): Promise<Readable> {
    return createReadStream(this.pathFor(key));
  }
}
