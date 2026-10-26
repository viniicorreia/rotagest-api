import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import type { AppConfig } from '../../config/app-config.service';
import type { StorageDriver } from './storage.service';

/**
 * Bucket S3 ou compatível (MinIO, Cloudflare R2...). Os objetos são privados:
 * nenhum ACL público é enviado e não geramos URLs pré-assinadas; o download é
 * transmitido pela API. Credenciais vêm da cadeia padrão da AWS
 * (AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY, perfil, role da instância...).
 */
export class S3StorageDriver implements StorageDriver {
  constructor(
    private readonly client: Pick<S3Client, 'send'>,
    private readonly bucket: string,
  ) {}

  static fromConfig(config: AppConfig): S3StorageDriver {
    const endpoint = config.get('S3_ENDPOINT');
    const client = new S3Client({
      region: config.get('S3_REGION'),
      endpoint,
      forcePathStyle: config.get('S3_FORCE_PATH_STYLE'),
      // Provedores compatíveis nem sempre aceitam os checksums opcionais do SDK.
      ...(endpoint ? { requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED' } : {}),
    });
    return new S3StorageDriver(client, config.get('S3_BUCKET')!);
  }

  async put(key: string, data: Buffer, contentType = 'application/octet-stream'): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentType: contentType, ContentLength: data.length }),
    );
  }

  async read(key: string): Promise<Readable> {
    const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!(out.Body instanceof Readable)) throw new Error('Resposta do S3 sem conteúdo');
    return out.Body;
  }
}
