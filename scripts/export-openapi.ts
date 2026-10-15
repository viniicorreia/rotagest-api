/**
 * Gera openapi.json (contrato da API) sem precisar de banco: o app é criado em
 * modo preview, que registra rotas e metadados sem instanciar provedores.
 * O rotagest-web gera seus tipos a partir deste arquivo ou de /api/docs-json.
 */
import { NestFactory } from '@nestjs/core';
import { VersioningType } from '@nestjs/common';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppModule } from '../src/app.module';
import { buildOpenApiDocument } from '../src/setup-app';

async function main(): Promise<void> {
  process.env.DATABASE_URL ??= 'postgresql://preview@localhost:5432/preview';
  process.env.JWT_ACCESS_SECRET ??= 'preview-secret-preview-secret-preview-secret';
  const app = await NestFactory.create(AppModule, { preview: true, logger: false, abortOnError: false });
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  const document = buildOpenApiDocument(app);
  const out = join(__dirname, '..', 'openapi.json');
  writeFileSync(out, JSON.stringify(document, null, 2) + '\n');
  console.log(`OpenAPI gravado em ${out} (${Object.keys(document.paths).length} rotas)`);
  await app.close();
}

void main();
