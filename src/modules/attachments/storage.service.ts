import { Inject, Injectable } from '@nestjs/common';
import type { Readable } from 'node:stream';
import { AppConfig } from '../../config/app-config.service';
import { LocalStorageDriver } from './local-storage.driver';
import { S3StorageDriver } from './s3-storage.driver';

/** Backend de armazenamento dos arquivos (disco local ou bucket S3). */
export interface StorageDriver {
  put(key: string, data: Buffer, contentType?: string): Promise<void>;
  read(key: string): Promise<Readable>;
}

export const STORAGE_DRIVER = Symbol('STORAGE_DRIVER');

/** Recusa chaves que possam escapar do prefixo da empresa (`..`, absolutas, caracteres estranhos). */
export function assertSafeKey(key: string): void {
  if (!/^[\w-]+(\/[\w-]+)*\.[a-z0-9]+$/i.test(key)) throw new Error('Chave de armazenamento inválida');
}

/** STORAGE_DRIVER=s3 grava no bucket; o padrão continua sendo o disco local (STORAGE_DIR). */
export function createStorageDriver(config: AppConfig): StorageDriver {
  return config.get('STORAGE_DRIVER') === 's3' ? S3StorageDriver.fromConfig(config) : new LocalStorageDriver(config.get('STORAGE_DIR'));
}

/**
 * Armazenamento privado de comprovantes. Nada é servido estaticamente nem por
 * URL pública/pré-assinada: o download passa sempre pela API, que confere
 * tenant e permissão. O backend (disco ou S3) é escolhido por STORAGE_DRIVER.
 */
@Injectable()
export class StorageService {
  constructor(@Inject(STORAGE_DRIVER) private readonly driver: StorageDriver) {}

  put(key: string, data: Buffer, contentType?: string): Promise<void> {
    assertSafeKey(key);
    return this.driver.put(key, data, contentType);
  }

  read(key: string): Promise<Readable> {
    assertSafeKey(key);
    return this.driver.read(key);
  }
}
