import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildOpenApiDocument } from '../src/setup-app';
import { createTestApp, type TestApp } from './helpers';

describe('Contrato OpenAPI (e2e)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('todas as rotas são versionadas em /api/v1', () => {
    const paths = Object.keys(buildOpenApiDocument(t.app).paths);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.every((p) => p.startsWith('/api/v1/'))).toBe(true);
  });

  it('openapi.json versionado no repositório está atualizado (rode npm run openapi:export)', () => {
    const committed = JSON.parse(readFileSync(join(__dirname, '..', 'openapi.json'), 'utf8'));
    const current = JSON.parse(JSON.stringify(buildOpenApiDocument(t.app)));
    expect(current.paths).toEqual(committed.paths);
    expect(current.components).toEqual(committed.components);
  });

  it('expõe o JSON do contrato e o catálogo de acesso', async () => {
    const doc = await t.http().get('/api/docs-json').expect(200);
    expect(doc.body.info.title).toBe('RotaGest API');
    const meta = await t.http().get('/api/v1/meta/access-control').expect(200);
    expect(meta.body.roles.map((r: { key: string }) => r.key)).toEqual(['OWNER', 'MANAGER', 'FINANCIAL', 'DRIVER']);
    expect(meta.body.permissions.find((p: { key: string }) => p.key === 'members:manage').grantable).toBe(false);
  });

  it('CORS libera apenas origens configuradas, com credenciais', async () => {
    const ok = await t.http().options('/api/v1/auth/login').set('Origin', 'http://localhost:5173').set('Access-Control-Request-Method', 'POST');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    const bad = await t.http().options('/api/v1/auth/login').set('Origin', 'https://site-malicioso.com').set('Access-Control-Request-Method', 'POST');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });
});
