import {
  addMember,
  bearer,
  createTestApp,
  createVehicle,
  ownerWithCompany,
  PASSWORD,
  register,
  resetDb,
  type Session,
  type TestApp,
} from './helpers';

describe('Acesso de suporte com consentimento (e2e)', () => {
  let t: TestApp;
  let admin: Session;
  let owner: Session;
  let companyId: string;

  const as = (s: Session) => ({
    get: (path: string) => t.http().get(`/api/v1${path}`).set(bearer(s)),
    post: (path: string, body: object = {}) => t.http().post(`/api/v1${path}`).set(bearer(s)).send(body),
  });

  beforeAll(async () => {
    t = await createTestApp();
    await resetDb();
    admin = await register(t, 'Suporte RotaGest');
    await t.prisma.user.update({ where: { id: admin.userId }, data: { platformRole: 'SUPER_ADMIN' } });
    let company: { id: string };
    ({ owner, company } = await ownerWithCompany(t, 'Vans da Consulta'));
    companyId = company.id;
    await createVehicle(t, owner, 'Van 01');
  });
  afterAll(() => t.close());

  it('sem autorização, o suporte não entra na empresa', async () => {
    const res = await as(admin).post(`/platform/companies/${companyId}/support-session`).expect(409);
    expect(res.body.message).toMatch(/não autorizou/);
    const detail = await as(admin).get(`/platform/companies/${companyId}`).expect(200);
    expect(detail.body.supportAccess).toBeNull();
  });

  it('só o dono autoriza; prazo de até 72 h e justificativa obrigatória', async () => {
    const { member: manager } = await addMember(t, owner, 'MANAGER');
    await as(manager).post('/support-access', { hours: 2, reason: 'Conferir os relatórios' }).expect(403);
    await as(owner).post('/support-access', { hours: 73, reason: 'Conferir os relatórios' }).expect(400);
    await as(owner).post('/support-access', { hours: 2, reason: 'curta' }).expect(400);
  });

  it('com autorização, o suporte lê os dados, não grava, e cada leitura fica registrada', async () => {
    const grant = await as(owner).post('/support-access', { hours: 2, reason: 'Conferir os relatórios de setembro' }).expect(201);
    expect(grant.body.status).toBe('ACTIVE');
    await as(owner).post('/support-access', { hours: 1, reason: 'Outra autorização qualquer' }).expect(409);

    const detail = await as(admin).get(`/platform/companies/${companyId}`).expect(200);
    expect(detail.body.supportAccess.reason).toBe('Conferir os relatórios de setembro');

    const session = await as(admin).post(`/platform/companies/${companyId}/support-session`).expect(200);
    const support: Session = { ...admin, token: session.body.accessToken };

    const me = await as(support).get('/auth/me').expect(200);
    expect(me.body.activeCompany.id).toBe(companyId);
    expect(me.body.activeCompany.support.expiresAt).toBeTruthy();
    expect(me.body.activeCompany.permissions).not.toContain('finance:manage');

    const vehicles = await as(support).get('/vehicles').expect(200);
    expect(vehicles.body.items.map((v: { name: string }) => v.name)).toEqual(['Van 01']);
    await as(support).get('/members').expect(200);

    const write = await as(support).post('/vehicles', { name: 'Van do suporte', plate: 'SUP1A23' }).expect(403);
    expect(write.body.code).toBe('SUPPORT_READ_ONLY');
    await as(support).get('/support-access').expect(403); // gerenciar a autorização é só do dono

    const overview = await as(owner).get('/support-access').expect(200);
    expect(overview.body.active.accessCount).toBe(3); // me não conta (sem empresa); vehicles, members e a tentativa negada de /support-access
    const log = await as(owner).get(`/support-access/${grant.body.id}/log`).expect(200);
    expect(log.body.map((e: { path: string }) => e.path)).toContain('/api/v1/vehicles');
    expect(log.body[0].actorName).toBe('Suporte RotaGest');

    // Revogada, a sessão de suporte para na próxima requisição.
    await as(owner).post(`/support-access/${grant.body.id}/revoke`).expect(200);
    await as(support).get('/vehicles').expect(403);
    const after = await as(owner).get('/support-access').expect(200);
    expect(after.body.active).toBeNull();
    expect(after.body.grants[0].status).toBe('REVOKED');

    const history = await as(admin).get(`/platform/companies/${companyId}`).expect(200);
    expect(history.body.history.map((h: { action: string }) => h.action)).toEqual(
      expect.arrayContaining(['support.granted', 'support.session_started', 'support.revoked']),
    );

    const end = await as(admin).post('/platform/support-session/end').expect(200);
    expect(end.body.activeCompanyId).toBeNull();
  });

  it('autorização vencida não abre a empresa', async () => {
    const grant = await as(owner).post('/support-access', { hours: 1, reason: 'Ajuda com o fechamento' }).expect(201);
    await t.prisma.$executeRaw`UPDATE support_grants SET "createdAt" = now() - interval '2 hours', "expiresAt" = now() - interval '1 hour' WHERE id = ${grant.body.id}::uuid`;
    await as(admin).post(`/platform/companies/${companyId}/support-session`).expect(409);
    const overview = await as(owner).get('/support-access').expect(200);
    expect(overview.body.grants.find((g: { id: string }) => g.id === grant.body.id).status).toBe('EXPIRED');
  });

  it('usuário comum não usa as rotas do suporte', async () => {
    await as(owner).post(`/platform/companies/${companyId}/support-session`).expect(403);
  });
});

describe('Dados pessoais (LGPD) (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
    await resetDb();
  });
  afterAll(() => t.close());

  it('exporta os dados do próprio usuário, sem dados de outros', async () => {
    const { owner } = await ownerWithCompany(t, 'Empresa do Titular');
    await ownerWithCompany(t, 'Outra Empresa');
    const res = await t.http().get('/api/v1/me/data-export').set(bearer(owner)).expect(200);
    expect(res.headers['content-disposition']).toContain('meus-dados-rotagest.json');
    expect(res.body.user.email).toBe(owner.email);
    expect(res.body.user).not.toHaveProperty('passwordHash');
    expect(res.body.memberships).toHaveLength(1);
    expect(res.body.memberships[0].company.tradeName).toBe('Empresa do Titular');
    expect(res.body.sessions.length).toBeGreaterThan(0);
    expect(res.body.activity.map((a: { action: string }) => a.action)).toContain('auth.registered');
  });

  it('dono de empresa ativa não exclui a conta; membro exclui e fica anonimizado', async () => {
    const { owner } = await ownerWithCompany(t, 'Transportes Exclusão');
    const blocked = await t.http().post('/api/v1/me/delete').set(bearer(owner)).send({ password: PASSWORD }).expect(409);
    expect(blocked.body.code).toBe('ACCOUNT_OWNS_COMPANY');

    const { member } = await addMember(t, owner, 'FINANCIAL');
    await t.http().post('/api/v1/me/delete').set(bearer(member)).send({ password: 'SenhaErrada1' }).expect(401);
    const res = await t.http().post('/api/v1/me/delete').set(bearer(member)).set('Cookie', member.cookie).send({ password: PASSWORD }).expect(204);
    expect(String(res.headers['set-cookie'])).toContain('rg_refresh=;');

    const user = await t.prisma.user.findUniqueOrThrow({ where: { id: member.userId } });
    expect(user.name).toBe('Conta excluída');
    expect(user.email).toMatch(/@anonimo\.invalid$/);
    expect(user.status).toBe('DISABLED');
    expect(user.anonymizedAt).not.toBeNull();

    // Sessões encerradas e login impossível; o e-mail fica livre para um novo cadastro.
    await t.http().get('/api/v1/auth/me').set(bearer(member)).expect(401);
    await t.http().post('/api/v1/auth/login').send({ email: member.email, password: PASSWORD }).expect(401);
    await register(t, 'De Volta', member.email);

    const members = await t.http().get('/api/v1/members').set(bearer(owner)).expect(200);
    const gone = members.body.find((m: { user?: { id: string }; userId?: string }) => (m.user?.id ?? m.userId) === member.userId);
    expect(gone?.status ?? 'INACTIVE').toBe('INACTIVE');
  });

  it('remove os dados pessoais de um motorista inativo e mantém o cadastro', async () => {
    const { owner } = await ownerWithCompany(t, 'Transportes Motoristas');
    const driver = await t.http().post('/api/v1/drivers').set(bearer(owner)).send({ name: 'José da Silva', document: '52998224725', phone: '19999990000' }).expect(201);
    await t.http().post(`/api/v1/drivers/${driver.body.id}/anonymize`).set(bearer(owner)).expect(422);
    await t.http().patch(`/api/v1/drivers/${driver.body.id}`).set(bearer(owner)).send({ status: 'INACTIVE' }).expect(200);
    const res = await t.http().post(`/api/v1/drivers/${driver.body.id}/anonymize`).set(bearer(owner)).expect(200);
    expect(res.body).toMatchObject({ anonymized: true, phone: null, hiredAt: null });
    expect(res.body.name).toMatch(/^Motorista removido/);
    expect(res.body.document).not.toContain('52998224725');
    await t.http().patch(`/api/v1/drivers/${driver.body.id}`).set(bearer(owner)).send({ name: 'Outro' }).expect(409);
    await t.http().post(`/api/v1/drivers/${driver.body.id}/anonymize`).set(bearer(owner)).expect(409);
    // O CPF pode ser cadastrado de novo.
    await t.http().post('/api/v1/drivers').set(bearer(owner)).send({ name: 'José da Silva', document: '52998224725' }).expect(201);
  });
});
