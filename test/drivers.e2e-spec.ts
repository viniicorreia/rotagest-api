import { bearer, createTestApp, ownerWithCompany, resetDb, type Session, type TestApp } from './helpers';

describe('Motorista sem CPF (e2e)', () => {
  let t: TestApp;
  let owner: Session;

  beforeAll(async () => {
    t = await createTestApp();
    await resetDb(t.prisma);
    ({ owner } = await ownerWithCompany(t, 'Vans Sem CPF'));
  });
  afterAll(() => t.close());

  const create = (body: Record<string, unknown>) => t.http().post('/api/v1/drivers').set(bearer(owner)).send(body);

  it('cadastra só com o nome; vários motoristas podem ficar sem CPF', async () => {
    const a = await create({ name: 'Ana Sem Documento' }).expect(201);
    expect(a.body.document).toBeNull();
    const b = await create({ name: 'Beto Sem Documento', document: '' }).expect(201);
    expect(b.body.document).toBeNull();
  });

  it('o CPF pode ser informado depois e removido de novo', async () => {
    const d = await create({ name: 'Carla' }).expect(201);
    const withCpf = await t.http().patch(`/api/v1/drivers/${d.body.id}`).set(bearer(owner)).send({ document: '529.982.247-25' }).expect(200);
    expect(withCpf.body.document).toBe('52998224725');
    // Continua único por empresa quando informado, e inválido continua recusado.
    await create({ name: 'Outra', document: '52998224725' }).expect(409);
    await create({ name: 'CPF ruim', document: '12345678900' }).expect(400);
    const cleared = await t.http().patch(`/api/v1/drivers/${d.body.id}`).set(bearer(owner)).send({ document: null }).expect(200);
    expect(cleared.body.document).toBeNull();
  });
});
