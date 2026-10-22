import { createTestApp, type TestApp } from './helpers';

const METRICS_TOKEN = 'token-de-metricas-de-teste';

describe('Saúde e métricas (e2e)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ METRICS_TOKEN });
  });
  afterAll(() => t.close());

  // O 503 da readiness (banco fora / lento) é coberto em health.controller.spec.ts.
  it('liveness, readiness e a rota antiga respondem sem autenticação', async () => {
    await t.http().get('/api/v1/health').expect(200, { status: 'ok' });
    await t.http().get('/api/v1/health/live').expect(200, { status: 'ok' });
    await t.http().get('/api/v1/health/ready').expect(200, { status: 'ok' });
  });

  it('toda resposta traz x-request-id (gerado ou repassado)', async () => {
    const gen = await t.http().get('/api/v1/health/live').expect(200);
    expect(gen.headers['x-request-id']).toMatch(/^[\w-]{8,64}$/);
    const given = await t.http().get('/api/v1/health/live').set('X-Request-Id', 'req-abc-12345').expect(200);
    expect(given.headers['x-request-id']).toBe('req-abc-12345');
  });

  it('/metrics exige o token e rotula pela rota modelo, sem IDs', async () => {
    await t.http().get('/api/v1/metrics').expect(401);
    await t.http().get('/api/v1/metrics').set('Authorization', 'Bearer errado').expect(401);
    await t.http().get('/api/v1/attachments/00000000-0000-4000-8000-000000000123/download').expect(401);
    const res = await t.http().get('/api/v1/metrics').set('Authorization', `Bearer ${METRICS_TOKEN}`).expect(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toContain('process_cpu_user_seconds_total');
    expect(res.text).toMatch(/http_request_duration_seconds_count\{method="GET",route="\/api\/v1\/health\/live",status_code="200"\} \d+/);
    expect(res.text).toContain('route="/api/v1/attachments/:id/download",status_code="401"');
    expect(res.text).not.toContain('00000000-0000-4000-8000-000000000123');
  });

  it('/metrics responde 404 quando METRICS_TOKEN não está configurado', async () => {
    const other = await createTestApp();
    try {
      await other.http().get('/api/v1/metrics').set('Authorization', `Bearer ${METRICS_TOKEN}`).expect(404);
    } finally {
      await other.close();
    }
  });
});
