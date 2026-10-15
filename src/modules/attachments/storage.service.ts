import { Injectable } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { AppConfig } from '../../config/app-config.service';

/**
 * Armazenamento privado de comprovantes. Implementação em disco local, numa
 * pasta que nunca é servida estaticamente; o download passa sempre pela API.
 * A Fase 6 troca por S3 mantendo esta interface.
 */
@Injectable()
export class StorageService {
  constructor(private readonly config: AppConfig) {}

  private root(): string {
    return resolve(this.config.get('STORAGE_DIR'));
  }

  /** Resolve a chave dentro da raiz, recusando qualquer tentativa de sair dela. */
  private pathFor(key: string): string {
    const root = this.root();
    const full = resolve(root, key);
    if (!full.startsWith(root + sep)) throw new Error('Chave de armazenamento inválida');
    return full;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const full = this.pathFor(key);
    await mkdir(dirname(full), { recursive: true, mode: 0o700 });
    await writeFile(full, data, { mode: 0o600, flag: 'wx' });
  }

  read(key: string): Readable {
    return createReadStream(this.pathFor(key));
  }
}
