import { PrismaClient } from '@prisma/client';
import { runWithDbContext } from '../src/common/tenant/db-context';
import { bearer, createTestApp, createVehicle, ownerWithCompany, resetDb, type TestApp } from './helpers';

/**
 * Row-Level Security: segunda barreira do isolamento entre empresas, no próprio
 * PostgreSQL. Mesmo uma consulta sem filtro por companyId só enxerga a empresa
 * informada no contexto da transação.
 */
describe('RLS (e2e)', () => {
  let t: TestApp;
  let raw: PrismaClient; // papel da aplicação, sem o embrulho do PrismaService
  let a: Awaited<ReturnType<typeof ownerWithCompany>>;
  let b: Awaited<ReturnType<typeof ownerWithCompany>>;

  beforeAll(async () => {
    t = await createTestApp();
    await resetDb();
    raw = new PrismaClient();
    a = await ownerWithCompany(t, 'Empresa A');
    b = await ownerWithCompany(t, 'Empresa B');
    await createVehicle(t, a.owner, 'Van A1');
    await createVehicle(t, a.owner, 'Van A2');
    await createVehicle(t, b.owner, 'Van B1');
  });

  afterAll(async () => {
    await raw.$disconnect();
    await t.close();
  });

  const asApp = <T>(companyId: string | null, bypass: boolean, fn: (tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]) => Promise<T>) =>
    raw.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.company_id', ${companyId ?? ''}, true), set_config('app.bypass', ${bypass ? 'on' : 'off'}, true)`;
      return fn(tx);
    });

  it('a API conecta com um papel sujeito ao RLS (não é dono nem superusuário)', async () => {
    const [role] = await raw.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean; current_user: string }[]>`
      SELECT rolsuper, rolbypassrls, current_user FROM pg_roles WHERE rolname = current_user`;
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false, current_user: 'rotagest_app' });
  });

  it('sem contexto, nenhuma linha de empresa é visível e nada pode ser gravado', async () => {
    expect(await raw.vehicle.count()).toBe(0);
    expect(await raw.company.count()).toBe(0);
    await expect(
      raw.vehicle.create({ data: { companyId: a.company.id, name: 'Intrusa', plate: 'ZZZ9Z99' } }),
    ).rejects.toThrow(/row-level security/);
  });

  it('com a empresa A no contexto, uma consulta sem filtro só devolve dados da A', async () => {
    const names = await asApp(a.company.id, false, (tx) => tx.vehicle.findMany({ select: { name: true }, orderBy: { name: 'asc' } }));
    expect(names.map((v) => v.name)).toEqual(['Van A1', 'Van A2']);
    const companies = await asApp(a.company.id, false, (tx) => tx.company.findMany({ select: { id: true } }));
    expect(companies).toEqual([{ id: a.company.id }]);
  });

  it('não grava nem altera linhas de outra empresa', async () => {
    await expect(
      asApp(a.company.id, false, (tx) => tx.vehicle.create({ data: { companyId: b.company.id, name: 'Intrusa', plate: 'ZZZ9Z98' } })),
    ).rejects.toThrow(/row-level security/);
    const updated = await asApp(a.company.id, false, (tx) =>
      tx.vehicle.updateMany({ where: { companyId: b.company.id }, data: { name: 'Alterada' } }),
    );
    expect(updated.count).toBe(0);
    const bVans = await t.prisma.vehicle.findMany({ where: { companyId: b.company.id } });
    expect(bVans.map((v) => v.name)).toEqual(['Van B1']);
  });

  it('o PrismaService aplica o contexto em modelos, SQL avulso e transações', async () => {
    // As consultas do Prisma só rodam no await, por isso ele fica dentro do contexto.
    const ctx = { companyId: b.company.id, bypass: false };
    const viaModel = await runWithDbContext(ctx, async () => await t.prisma.vehicle.findMany({ select: { name: true } }));
    expect(viaModel.map((v) => v.name)).toEqual(['Van B1']);

    const viaRaw = await runWithDbContext(ctx, async () => await t.prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM vehicles`);
    expect(Number(viaRaw[0].n)).toBe(1);

    const viaTx = await runWithDbContext(ctx, async () => await t.prisma.$transaction((tx) => tx.vehicle.count()));
    expect(viaTx).toBe(1);

    const none = await runWithDbContext({ companyId: null, bypass: false }, async () => await t.prisma.vehicle.count());
    expect(none).toBe(0);

    // Fora de uma requisição (seed, scripts, testes) o acesso é irrestrito.
    expect(await t.prisma.vehicle.count()).toBe(3);
  });

  it('o contexto de uma requisição não vaza para outra concorrente', async () => {
    const [ra, rb] = await Promise.all([
      t.http().get('/api/v1/vehicles').set(bearer(a.owner)).expect(200),
      t.http().get('/api/v1/vehicles').set(bearer(b.owner)).expect(200),
    ]);
    const names = (res: { body: unknown }) => {
      const body = res.body as { items: { name: string }[] };
      return body.items.map((v) => v.name).sort();
    };
    expect(names(ra)).toEqual(['Van A1', 'Van A2']);
    expect(names(rb)).toEqual(['Van B1']);
  });

  it('a auditoria só aceita inserções e o papel não pode apagar tabelas', async () => {
    await expect(asApp(null, true, (tx) => tx.$executeRaw`UPDATE audit_logs SET action = 'x'`)).rejects.toThrow(/permission denied/);
    await expect(asApp(null, true, (tx) => tx.$executeRaw`DELETE FROM audit_logs`)).rejects.toThrow(/permission denied/);
    await expect(raw.$executeRawUnsafe('TRUNCATE vehicles')).rejects.toThrow(/permission denied|must be owner/);
  });
});
