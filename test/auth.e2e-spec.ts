import { createTestApp, bearer, ownerWithCompany, PASSWORD, refreshCookieFrom, register, resetDb, type TestApp } from './helpers';

describe('Autenticação (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
    await resetDb(t.prisma);
  });
  afterAll(() => t.close());

  describe('cadastro e login', () => {
    it('cadastra com e-mail normalizado e senha em Argon2id', async () => {
      const res = await t
        .http()
        .post('/api/v1/auth/register')
        .send({ name: 'Maria', email: '  Maria@Exemplo.COM ', password: PASSWORD })
        .expect(201);
      expect(res.body.accessToken).toBeDefined();
      expect(res.body.activeCompanyId).toBeNull();
      const user = await t.prisma.user.findUniqueOrThrow({ where: { email: 'maria@exemplo.com' } });
      expect(user.passwordHash).toMatch(/^\$argon2id\$/);
      const cookie = (res.headers['set-cookie'] as unknown as string[]).join(';');
      expect(cookie).toMatch(/rg_refresh=/);
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/SameSite=Strict/);
      expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
    });

    it('rejeita e-mail duplicado e senha fraca', async () => {
      await t.http().post('/api/v1/auth/register').send({ name: 'Maria', email: 'maria@exemplo.com', password: PASSWORD }).expect(409);
      await t.http().post('/api/v1/auth/register').send({ name: 'Zé', email: 'ze@exemplo.com', password: 'semnumeros' }).expect(400);
    });

    it('faz login e responde de forma genérica a credenciais inválidas', async () => {
      const ok = await t.http().post('/api/v1/auth/login').send({ email: 'MARIA@exemplo.com', password: PASSWORD }).expect(200);
      expect(ok.body.accessToken).toBeDefined();

      const wrongPass = await t.http().post('/api/v1/auth/login').send({ email: 'maria@exemplo.com', password: 'Errada123' }).expect(401);
      const noUser = await t.http().post('/api/v1/auth/login').send({ email: 'ninguem@exemplo.com', password: 'Errada123' }).expect(401);
      expect(wrongPass.body.message).toBe(noUser.body.message);
      expect(wrongPass.body.code).toBe('INVALID_CREDENTIALS');

      const failed = await t.prisma.auditLog.count({ where: { action: 'auth.login_failed' } });
      expect(failed).toBeGreaterThan(0);
    });

    it('não expõe dados sem token e recusa token adulterado', async () => {
      await t.http().get('/api/v1/auth/me').expect(401);
      const s = await register(t);
      const [h, p] = s.token.split('.');
      await t.http().get('/api/v1/auth/me').set('Authorization', `Bearer ${h}.${p}.assinaturafalsa`).expect(401);
    });

    it('usuário bloqueado perde o acesso imediatamente', async () => {
      const s = await register(t);
      await t.http().get('/api/v1/auth/me').set(bearer(s)).expect(200);
      await t.prisma.user.update({ where: { id: s.userId }, data: { status: 'DISABLED' } });
      await t.http().get('/api/v1/auth/me').set(bearer(s)).expect(401);
      await t.http().post('/api/v1/auth/login').send({ email: s.email, password: PASSWORD }).expect(401);
    });

    it('login retoma a empresa usada por último', async () => {
      const { owner, company } = await ownerWithCompany(t, 'Empresa Login');
      const res = await t.http().post('/api/v1/auth/login').send({ email: owner.email, password: PASSWORD }).expect(200);
      expect(res.body.activeCompanyId).toBe(company.id);
    });
  });

  describe('refresh token', () => {
    it('rotaciona o refresh e mantém a empresa ativa', async () => {
      const { owner, company } = await ownerWithCompany(t);
      const res = await t.http().post('/api/v1/auth/refresh').set('Cookie', owner.cookie).expect(200);
      expect(res.body.activeCompanyId).toBe(company.id);
      const next = refreshCookieFrom(res);
      expect(next).not.toBe(owner.cookie);
      await t.http().get('/api/v1/companies/current').set('Authorization', `Bearer ${res.body.accessToken}`).expect(200);
    });

    it('reuso de refresh já rotacionado revoga a família inteira', async () => {
      const s = await register(t);
      const first = await t.http().post('/api/v1/auth/refresh').set('Cookie', s.cookie).expect(200);
      const rotated = refreshCookieFrom(first);

      // Atacante reapresenta o token antigo.
      await t.http().post('/api/v1/auth/refresh').set('Cookie', s.cookie).expect(401);
      // O token legítimo mais novo também deixa de valer...
      await t.http().post('/api/v1/auth/refresh').set('Cookie', rotated).expect(401);
      // ...e o access token emitido para a família é recusado na hora.
      await t.http().get('/api/v1/auth/me').set('Authorization', `Bearer ${first.body.accessToken}`).expect(401);
      expect(await t.prisma.auditLog.count({ where: { action: 'auth.refresh_reuse_detected', actorUserId: s.userId } })).toBe(1);
    });

    it('refreshes concorrentes com o mesmo token: só um vence', async () => {
      const s = await register(t);
      const results = await Promise.all([
        t.http().post('/api/v1/auth/refresh').set('Cookie', s.cookie),
        t.http().post('/api/v1/auth/refresh').set('Cookie', s.cookie),
      ]);
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toContain(200);
      expect(statuses.filter((x) => x === 200)).toHaveLength(1);
    });

    it('logout revoga a sessão e o access token', async () => {
      const s = await register(t);
      await t.http().post('/api/v1/auth/logout').set('Cookie', s.cookie).expect(204);
      await t.http().post('/api/v1/auth/refresh').set('Cookie', s.cookie).expect(401);
      await t.http().get('/api/v1/auth/me').set(bearer(s)).expect(401);
    });

    it('sem cookie não renova', async () => {
      await t.http().post('/api/v1/auth/refresh').expect(401);
    });
  });

  describe('redefinição de senha', () => {
    it('responde 204 mesmo para e-mail inexistente (sem enumeração)', async () => {
      await t.http().post('/api/v1/auth/forgot-password').send({ email: 'naoexiste@exemplo.com' }).expect(204);
      expect(t.mail.lastTo('naoexiste@exemplo.com')).toBeUndefined();
    });

    it('redefine com token de uso único e encerra todas as sessões', async () => {
      const s = await register(t);
      await t.http().post('/api/v1/auth/forgot-password').send({ email: s.email }).expect(204);
      const url = t.mail.lastTo(s.email)?.actionUrl;
      expect(url).toBeDefined();
      const token = decodeURIComponent(new URL(url!).searchParams.get('token')!);

      await t.http().post('/api/v1/auth/reset-password').send({ token, password: 'NovaSenha999' }).expect(204);
      await t.http().post('/api/v1/auth/reset-password').send({ token, password: 'OutraSenha999' }).expect(401);

      await t.http().get('/api/v1/auth/me').set(bearer(s)).expect(401);
      await t.http().post('/api/v1/auth/login').send({ email: s.email, password: PASSWORD }).expect(401);
      await t.http().post('/api/v1/auth/login').send({ email: s.email, password: 'NovaSenha999' }).expect(200);

      const stored = await t.prisma.passwordResetToken.findFirstOrThrow({ where: { userId: s.userId } });
      expect(stored.tokenHash).not.toContain(token);
    });
  });
});

describe('Rate limiting (e2e)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ RATE_LIMIT_AUTH: 3 });
  });
  afterAll(() => t.close());

  it('bloqueia tentativas excessivas de login', async () => {
    const attempt = () => t.http().post('/api/v1/auth/login').send({ email: 'x@exemplo.com', password: 'Errada123' });
    for (let i = 0; i < 3; i++) expect((await attempt()).status).toBe(401);
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('RATE_LIMITED');
  });

  it('não aplica o limite de autenticação às demais rotas', async () => {
    for (let i = 0; i < 5; i++) await t.http().get('/api/v1/health').expect(200);
  });
});
