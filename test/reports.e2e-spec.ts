import { PrismaClient } from '@prisma/client';
import { addMember, bearer, categoryId, createAccount, createTestApp, createVehicle, dates, key, ownerWithCompany, resetDb, type Session, type TestApp } from './helpers';

const prev = dates.month(-1);

describe('Relatórios e fechamento mensal (e2e)', () => {
  let t: TestApp;
  let owner: Session;
  let v1: { id: string };
  let v2: { id: string };
  let accountId: string;

  const get = (s: Session, path: string) => t.http().get(`/api/v1${path}`).set(bearer(s));

  beforeAll(async () => {
    t = await createTestApp();
    await resetDb(t.prisma);
    ({ owner } = await ownerWithCompany(t, 'Vans do Relatório'));
    await t.prisma.subscription.updateMany({ data: { overrideMaxUsers: 10 } });
    v1 = await createVehicle(t, owner, 'Van 01');
    v2 = await createVehicle(t, owner, 'Van 02');
    accountId = (await createAccount(t, owner, 'Banco', '1000.00', dates.dayOfMonth(-2, 1))).id;
    const paidOn = dates.dayOfMonth(-1, 10);
    const settle = () => ({ accountId, method: 'PIX', idempotencyKey: key(), settledAt: paidOn });
    // Mês anterior: contrato de 3.000 na Van 01 (recebido), diesel 500 na Van 01 (pago) e contador 400 rateado igualmente (em aberto).
    await t
      .http()
      .post('/api/v1/receivables')
      .set(bearer(owner))
      .send({ description: 'Escola Aurora', categoryId: await categoryId(t, owner, 'CONTRACT'), amount: '3000.00', competence: prev, dueDate: paidOn, vehicleId: v1.id, settleNow: settle() })
      .expect(201);
    await t
      .http()
      .post('/api/v1/payables')
      .set(bearer(owner))
      .send({ description: 'Diesel', categoryId: await categoryId(t, owner, 'FUEL'), amount: '500.00', competence: prev, dueDate: paidOn, vehicleId: v1.id, settleNow: settle() })
      .expect(201);
    await t
      .http()
      .post('/api/v1/payables')
      .set(bearer(owner))
      .send({
        description: 'Contador',
        categoryId: await categoryId(t, owner, 'ACCOUNTING'),
        amount: '400.00',
        competence: prev,
        dueDate: paidOn,
        allocationMethod: 'EQUAL',
        allocations: [{ vehicleId: v1.id }, { vehicleId: v2.id }],
      })
      .expect(201);
  });
  afterAll(() => t.close());

  describe('relatórios', () => {
    it('lista os 10 relatórios', async () => {
      const res = await get(owner, '/reports').expect(200);
      expect(res.body.items).toHaveLength(10);
    });

    it('resultado por veículo separa custo direto e rateado', async () => {
      const res = await get(owner, `/reports/result-by-vehicle?from=${prev}`).expect(200);
      expect(res.body.regime).toBe('ACCRUAL');
      const rows = res.body.sections[0].rows;
      expect(rows[0]).toMatchObject({ vehicle: expect.stringContaining('Van 01'), revenue: '3000.00', direct: '500.00', shared: '200.00', result: '2300.00', margin: '76.67' });
      expect(rows[1]).toMatchObject({ vehicle: expect.stringContaining('Van 02'), revenue: '0.00', shared: '200.00', result: '-200.00' });
      expect(res.body.sections[0].totals).toMatchObject({ revenue: '3000.00', result: '2100.00' });
    });

    it('fluxo de caixa usa a data efetiva e fecha com o saldo das contas', async () => {
      const res = await get(owner, `/reports/cash-flow?from=${prev}`).expect(200);
      expect(res.body.sections[0].rows[0]).toMatchObject({ month: prev, opening: '1000.00', in: '3000.00', out: '500.00', net: '2500.00', closing: '3500.00' });
      expect(res.body.sections[1].totals.balance).toBe('3500.00');
    });

    it('despesas por categoria, contas a pagar e comparativo com o período anterior', async () => {
      const cat = await get(owner, `/reports/expenses-by-category?from=${prev}&compare=true`).expect(200);
      expect(cat.body.sections[0].totals).toMatchObject({ expected: '900.00', paid: '500.00', open: '400.00' });
      expect(cat.body.comparison).toMatchObject({ from: dates.month(-2), to: dates.month(-2), totals: {} });

      const open = await get(owner, `/reports/payables?from=${prev}&status=OPEN`).expect(200);
      expect(open.body.sections[0].rows.map((r: { description: string }) => r.description)).toEqual(['Contador']);
      const byVehicle = await get(owner, `/reports/expenses-by-category?from=${prev}&vehicleId=${v2.id}`).expect(200);
      expect(byVehicle.body.sections[0].totals.expected).toBe('200.00');
    });

    it('exporta PDF e Excel com os mesmos dados', async () => {
      const pdf = await get(owner, `/reports/result-by-vehicle/export?format=pdf&from=${prev}`).buffer(true).parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      }).expect(200);
      expect(pdf.headers['content-type']).toContain('application/pdf');
      expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
      const xlsx = await get(owner, `/reports/payables/export?format=xlsx&from=${prev}`).buffer(true).parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      }).expect(200);
      expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe('PK');
      await get(owner, `/reports/payables/export?format=doc`).expect(400);
    });

    it('respeita a empresa e as permissões', async () => {
      const other = await ownerWithCompany(t, 'Outra');
      const res = await get(other.owner, `/reports/result-by-vehicle?from=${prev}`).expect(200);
      expect(res.body.sections[0].rows).toHaveLength(0);
      await get(other.owner, `/reports/fuel?from=${prev}&vehicleId=${v1.id}`).expect(404);
      await get(owner, '/reports/nao-existe').expect(400);
      const { member: driver } = await addMember(t, owner, 'DRIVER');
      await get(driver, '/reports/cash-flow').expect(403);
      await get(owner, `/reports/cash-flow?from=${dates.month(-30)}&to=${dates.month()}`).expect(400);
    });
  });

  describe('fechamento mensal', () => {
    it('prévia mostra os números e as pendências sem gravar', async () => {
      const res = await get(owner, `/closings/${prev}/preview`).expect(200);
      expect(res.body.totals).toMatchObject({ revenue: '3000.00', expense: '900.00', result: '2100.00', received: '3000.00', paid: '500.00', cashResult: '2500.00', balance: '3500.00' });
      expect(res.body.pending).toMatchObject({ payablesOpenCount: 1, payablesOpen: '400.00' });
      const detail = await get(owner, `/closings/${prev}`).expect(200);
      expect(detail.body).toMatchObject({ status: 'OPEN', version: 0, closable: true, snapshot: null });
    });

    it('fechar grava o snapshot e bloqueia lançamentos do mês', async () => {
      await t.http().post(`/api/v1/closings/${dates.month()}`).set(bearer(owner)).send({}).expect(422);
      const res = await t.http().post(`/api/v1/closings/${prev}`).set(bearer(owner)).send({ expectedVersion: 0 }).expect(200);
      expect(res.body).toMatchObject({ status: 'CLOSED', version: 1, closedBy: { id: owner.userId } });
      expect(res.body.snapshot.totals.result).toBe('2100.00');
      await t.http().post(`/api/v1/closings/${prev}`).set(bearer(owner)).send({}).expect(409);

      const blocked = await t
        .http()
        .post('/api/v1/payables')
        .set(bearer(owner))
        .send({ description: 'Esquecida', categoryId: await categoryId(t, owner, 'TOLL'), amount: '10.00', competence: prev, dueDate: dates.today() })
        .expect(409);
      expect(blocked.body.code).toBe('PERIOD_CLOSED');

      const list = await get(owner, `/closings?year=${prev.slice(0, 4)}`).expect(200);
      expect(list.body.items.find((i: { month: string }) => i.month === prev).status).toBe('CLOSED');
      const pdf = await get(owner, `/closings/${prev}/export?format=pdf`).expect(200);
      expect(pdf.headers['content-type']).toContain('application/pdf');
    });

    it('reabrir exige permissão e justificativa e fica auditado; fechar de novo vira versão 2', async () => {
      const { member: fin } = await addMember(t, owner, 'FINANCIAL');
      await t.http().post(`/api/v1/closings/${prev}/reopen`).set(bearer(fin)).send({ reason: 'Correção de nota fiscal' }).expect(403);
      await t.http().post(`/api/v1/closings/${prev}/reopen`).set(bearer(owner)).send({ reason: 'curta' }).expect(400);
      const reopened = await t.http().post(`/api/v1/closings/${prev}/reopen`).set(bearer(owner)).send({ reason: 'Correção de nota fiscal' }).expect(200);
      expect(reopened.body).toMatchObject({ status: 'REOPENED', reopenReason: 'Correção de nota fiscal', reopenedBy: { id: owner.userId } });
      const audit = await t.prisma.auditLog.findFirstOrThrow({ where: { action: 'closing.reopened' } });
      expect(audit.reason).toBe('Correção de nota fiscal');
      expect((audit.before as { snapshot: { totals: { result: string } } }).snapshot.totals.result).toBe('2100.00');

      await t
        .http()
        .post('/api/v1/payables')
        .set(bearer(owner))
        .send({ description: 'Pedágio esquecido', categoryId: await categoryId(t, owner, 'TOLL'), amount: '100.00', competence: prev, dueDate: dates.today() })
        .expect(201);
      // O financeiro fecha (closing:manage), mas não reabre.
      const again = await t.http().post(`/api/v1/closings/${prev}`).set(bearer(fin)).send({ expectedVersion: 1 }).expect(200);
      expect(again.body).toMatchObject({ status: 'CLOSED', version: 2 });
      expect(again.body.snapshot.totals.result).toBe('2000.00');
    });

    it('o fechamento espera os lançamentos do mês em andamento', async () => {
      await t.http().post(`/api/v1/closings/${prev}/reopen`).set(bearer(owner)).send({ reason: 'Conferência de concorrência' }).expect(200);
      const me = await get(owner, '/auth/me').expect(200);
      const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      let locked!: () => void;
      const isLocked = new Promise<void>((resolve) => (locked = resolve));
      // Simula um lançamento do mês ainda aberto: segura o lock compartilhado que assertOpen pega.
      const posting = admin.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext(${`closing:${me.body.activeCompany.id}:${prev}`}))`;
        locked();
        await held;
      }, { timeout: 20_000 });
      await isLocked;
      let done = false;
      const closing = t.http().post(`/api/v1/closings/${prev}`).set(bearer(owner)).send({}).then((r) => ((done = true), r));
      await new Promise((r) => setTimeout(r, 700));
      expect(done).toBe(false);
      release();
      await posting;
      expect((await closing).status).toBe(200);
      await admin.$disconnect();
    });

    it('outra empresa não vê nem fecha o mês desta', async () => {
      const other = await ownerWithCompany(t, 'Terceira');
      const res = await get(other.owner, `/closings/${prev}`).expect(200);
      expect(res.body.status).toBe('OPEN');
      await get(owner, '/closings/2026-13').expect(400);
    });
  });
});
