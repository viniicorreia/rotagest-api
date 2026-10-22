import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { AppConfig } from '../../config/app-config.service';
import type { Env } from '../../config/env';
import { LocalStorageDriver } from './local-storage.driver';
import { S3StorageDriver } from './s3-storage.driver';
import { createStorageDriver, StorageService } from './storage.service';

const configWith = (env: Partial<Env>) => ({ get: (key: keyof Env) => env[key] }) as unknown as AppConfig;

async function readAll(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString();
}

describe('Armazenamento de comprovantes', () => {
  it('usa disco local por padrão e S3 com STORAGE_DRIVER=s3', () => {
    expect(createStorageDriver(configWith({ STORAGE_DRIVER: 'local', STORAGE_DIR: tmpdir() }))).toBeInstanceOf(LocalStorageDriver);
    expect(createStorageDriver(configWith({ STORAGE_DRIVER: 's3', S3_BUCKET: 'b', S3_REGION: 'us-east-1' }))).toBeInstanceOf(S3StorageDriver);
  });

  it('driver local grava e lê dentro da pasta', async () => {
    const storage = new StorageService(new LocalStorageDriver(mkdtempSync(join(tmpdir(), 'rg-storage-'))));
    await storage.put('empresa/arquivo.pdf', Buffer.from('conteudo'));
    expect(await readAll(await storage.read('empresa/arquivo.pdf'))).toBe('conteudo');
  });

  it('recusa chaves que tentam sair do prefixo', async () => {
    const send = jest.fn();
    const storage = new StorageService(new S3StorageDriver({ send }, 'bucket'));
    for (const key of ['../x.pdf', '/abs/x.pdf', 'a/../../x.pdf', 'a//x.pdf', 'a/x']) {
      expect(() => storage.read(key)).toThrow('Chave de armazenamento inválida');
    }
    expect(send).not.toHaveBeenCalled();
  });

  describe('driver S3 (cliente simulado, sem rede)', () => {
    it('grava objeto privado com o tipo do arquivo', async () => {
      const send = jest.fn().mockResolvedValue({});
      const storage = new StorageService(new S3StorageDriver({ send }, 'rotagest-comprovantes'));
      await storage.put('c1/a1.pdf', Buffer.from('%PDF-1'), 'application/pdf');
      const cmd = send.mock.calls[0][0];
      expect(cmd).toBeInstanceOf(PutObjectCommand);
      expect(cmd.input).toEqual({ Bucket: 'rotagest-comprovantes', Key: 'c1/a1.pdf', Body: Buffer.from('%PDF-1'), ContentType: 'application/pdf', ContentLength: 6 });
      expect(cmd.input.ACL).toBeUndefined();
    });

    it('lê o objeto como stream', async () => {
      const send = jest.fn().mockResolvedValue({ Body: Readable.from([Buffer.from('abc')]) });
      const storage = new StorageService(new S3StorageDriver({ send }, 'bkt'));
      expect(await readAll(await storage.read('c1/a1.png'))).toBe('abc');
      const cmd = send.mock.calls[0][0];
      expect(cmd).toBeInstanceOf(GetObjectCommand);
      expect(cmd.input).toEqual({ Bucket: 'bkt', Key: 'c1/a1.png' });
    });

    it('propaga erro do S3 (ex.: objeto inexistente)', async () => {
      const send = jest.fn().mockRejectedValue(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' }));
      const storage = new StorageService(new S3StorageDriver({ send }, 'bkt'));
      await expect(storage.read('c1/x.pdf')).rejects.toThrow('NoSuchKey');
    });

    it('configura endpoint compatível (MinIO/R2) e path style', async () => {
      const driver = S3StorageDriver.fromConfig(
        configWith({ S3_BUCKET: 'b', S3_REGION: 'auto', S3_ENDPOINT: 'http://localhost:9000', S3_FORCE_PATH_STYLE: true }),
      );
      const client = (driver as unknown as { client: { config: { forcePathStyle?: boolean; region: () => Promise<string> } } }).client;
      expect(client.config.forcePathStyle).toBe(true);
      expect(await client.config.region()).toBe('auto');
    });
  });
});
