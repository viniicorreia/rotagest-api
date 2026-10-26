import { Prisma } from '@prisma/client';
import { addMember, balanceOf, bearer, categoryId, createAccount, createTestApp, createVehicle, dates, key, ownerWithCompany, resetDb, type Session, type TestApp } from './helpers';

describe('Contas a pagar/receber, liquidações e dashboard (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
    await resetDb(t.prisma);
  });
  afterAll(() => t.close());

  async function setup() {
    const { owner, company } = await ownerWithCompany(t);
    const account = await createAccount(t, owner, 'Banco', '1000.00');
    return { owner, company, account };
  }

  async function payable(s: Session, body: Record<string, unknown>) {
    const res = await t.http().post('/api/v1/payables').set(bearer(s)).send(body);
    if (res.status !== 201) throw new Error(`payable ${res.status}: ${JSON.stringify(res.body)}`);
    return res.body as { items: { id: string; amount: string; dueDate: string; competence: string; status: string; description: string }[]; recurrenceRuleId: string | null };
  }

  async function receivable(s: Session, body: Record<string, unknown>) {
    const res = await t.http().post('/api/v1/receivables').set(bearer(s)).send(body);
    if (res.status !== 201) throw new Error(`receivable ${res.status}: ${JSON.stringify(res.body)}`);
    return res.body as { items: { id: string; amount: string; status: string }[] };
  }

  /** Reconciliação (ARCHITECTURE.md §6.4): cache = Σ liquidações não estornadas. */
  async function reconciliationIssues(companyId: string) {
    const rows = await t.prisma.$queryRaw<{ id: string }[]>`
      SELECT p.id FROM payables p
      LEFT JOIN settlements s ON s."payableId" = p.id AND s."reversedAt" IS NULL
      WHERE p."companyId" = ${companyId}::uuid
      GROUP BY p.id HAVING p."paidAmount" <> COALESCE(SUM(s.amount), 0)
      UNION ALL
      SELECT r.id FROM receivables r
      LEFT JOIN settlements s ON s."receivableId" = r.id AND s."reversedAt" IS NULL
      WHERE r."companyId" = ${companyId}::uuid
      GROUP BY r.id HAVING r."receivedAmount" <> COALESCE(SUM(s.amount), 0)`;
    return rows.length;
  }

  describe('receitas', () => {
    it('separa competência, vencimento e recebimento; parcial atualiza o saldo pendente', async () => {
      const { owner, company, account } = await setup();
      const cat = await categoryId(t, owner, 'CONTRACT');
      // Contrato de R$ 12.000, competência do mês passado, vencimento no dia 10 deste mês.
      const created = await receivable(owner, {
        description: 'Escola Municipal',
        categoryId: cat,
        amount: '12000.00',
        competence: dates.month(-1),
        dueDate: dates.dayOfMonth(0, 10),
      });
      const id = created.items[0].id;
      expect(created.items[0]).toMatchObject({ status: 'PENDING', competence: dates.month(-1), dueDate: dates.dayOfMonth(0, 10) });
      // Receita prevista não altera saldo bancário.
      expect(await balanceOf(t, owner, account.id)).toBe('1000.00');

      const partial = await t
        .http()
        .post(`/api/v1/receivables/${id}/settlements`)
        .set(bearer(owner))
        .send({ accountId: account.id, amount: '5000.00', method: 'PIX', settledAt: dates.today(), idempotencyKey: key() })
        .expect(201);
      expect(partial.body.receivable).toMatchObject({ status: 'PARTIALLY_RECEIVED', receivedAmount: '5000.00', openAmount: '7000.00' });
      expect(partial.body.settlement).toMatchObject({ settledAt: dates.today(), method: 'PIX', amount: '5000.00' });
      expect(await balanceOf(t, owner, account.id)).toBe('6000.00');

      const over = await t
        .http()
        .post(`/api/v1/receivables/${id}/settlements`)
        .set(bearer(owner))
        .send({ accountId: account.id, amount: '7000.01', method: 'PIX', idempotencyKey: key() })
        .expect(422);
      expect(over.body.code).toBe('BUSINESS_RULE');

      // Sem valor = recebe todo o saldo em aberto.
      const total = await t.http().post(`/api/v1/receivables/${id}/settlements`).set(bearer(owner)).send({ accountId: account.id, method: 'TRANSFER', idempotencyKey: key() }).expect(201);
      expect(total.body.receivable).toMatchObject({ status: 'RECEIVED', openAmount: '0.00' });
      expect(await balanceOf(t, owner, account.id)).toBe('13000.00');
      await t.http().post(`/api/v1/receivables/${id}/settlements`).set(bearer(owner)).send({ accountId: account.id, method: 'PIX', idempotencyKey: key() }).expect(422);
      expect(await reconciliationIssues(company.id)).toBe(0);
    });

    it('não aceita recebimento com data futura nem em conta desativada', async () => {
      const { owner, account } = await setup();
      const r = await receivable(owner, { description: 'Frete', categoryId: await categoryId(t, owner, 'CHARTER'), amount: '100.00', competence: dates.month(), dueDate: dates.today() });
      await t.http().post(`/api/v1/receivables/${r.items[0].id}/settlements`).set(bearer(owner)).send({ accountId: account.id, method: 'PIX', settledAt: dates.daysAhead(1), idempotencyKey: key() }).expect(400);
      const empty = await createAccount(t, owner, 'Vazia', '0.00');
      await t.http().patch(`/api/v1/accounts/${empty.id}`).set(bearer(owner)).send({ status: 'INACTIVE' }).expect(200);
      await t.http().post(`/api/v1/receivables/${r.items[0].id}/settlements`).set(bearer(owner)).send({ accountId: empty.id, method: 'PIX', idempotencyKey: key() }).expect(422);
    });
  });

  describe('despesas', () => {
    it('parcelada: 1.000,00 em 3x com resto na última e vencimentos mensais', async () => {
      const { owner } = await setup();
      const res = await payable(owner, {
        description: 'Pneus',
        categoryId: await categoryId(t, owner, 'TIRES'),
        amount: '1000.00',
        competence: dates.month(),
        dueDate: dates.dayOfMonth(0, 31),
        kind: 'INSTALLMENT',
        installmentCount: 3,
      });
      expect(res.items.map((p) => p.amount)).toEqual(['333.33', '333.33', '333.34']);
      expect(res.items.map((p) => p.description)).toEqual(['Pneus (1/3)', 'Pneus (2/3)', 'Pneus (3/3)']);
      expect(res.items.map((p) => p.competence)).toEqual([dates.month(), dates.month(1), dates.month(2)]);
      expect(res.items.map((p) => p.dueDate)).toEqual([dates.dayOfMonth(0, 31), dates.dayOfMonth(1, 31), dates.dayOfMonth(2, 31)]);
    });

    it('recorrente: gera até o mês que vem, sem duplicar, e pode ser encerrada', async () => {
      const { owner } = await setup();
      const res = await payable(owner, {
        description: 'Rastreador',
        categoryId: await categoryId(t, owner, 'TRACKER'),
        amount: '89.90',
        competence: dates.month(-2),
        dueDate: dates.dayOfMonth(-2, 5),
        kind: 'RECURRING',
        recurrence: { frequency: 'MONTHLY' },
      });
      expect(res.items.map((p) => p.competence)).toEqual([dates.month(-2), dates.month(-1), dates.month(), dates.month(1)]);
      expect(res.items.map((p) => p.dueDate)).toEqual([-2, -1, 0, 1].map((m) => dates.dayOfMonth(m, 5)));

      // Gerar de novo (listagem em paralelo) não duplica.
      await Promise.all([1, 2, 3].map(() => t.http().get('/api/v1/payables?pageSize=100').set(bearer(owner)).expect(200)));
      expect(await t.prisma.payable.count({ where: { recurrenceRuleId: res.recurrenceRuleId! } })).toBe(4);

      const rules = await t.http().get('/api/v1/recurrences?target=PAYABLE').set(bearer(owner)).expect(200);
      expect(rules.body[0]).toMatchObject({ amount: '89.90', status: 'ACTIVE', lastGeneratedMonth: dates.month(1) });
      await t.http().post(`/api/v1/recurrences/${res.recurrenceRuleId}/stop`).set(bearer(owner)).expect(200);
      const after = await t.http().get('/api/v1/recurrences').set(bearer(owner)).expect(200);
      expect(after.body[0].status).toBe('INACTIVE');
    });

    it('lista com status derivado de vencida e totais do filtro', async () => {
      const { owner } = await setup();
      const cat = await categoryId(t, owner, 'INSURANCE');
      await payable(owner, { description: 'Seguro vencido', categoryId: cat, amount: '300.00', competence: dates.month(), dueDate: dates.daysAgo(2) });
      await payable(owner, { description: 'Seguro futuro', categoryId: cat, amount: '200.00', competence: dates.month(), dueDate: dates.daysAhead(10) });
      const overdue = await t.http().get('/api/v1/payables?status=OVERDUE').set(bearer(owner)).expect(200);
      expect(overdue.body.items).toHaveLength(1);
      expect(overdue.body.items[0]).toMatchObject({ description: 'Seguro vencido', status: 'PENDING', overdue: true });
      const all = await t.http().get('/api/v1/payables').set(bearer(owner)).expect(200);
      expect(all.body.summary).toMatchObject({ amount: '500.00', settled: '0.00', open: '500.00', overdue: '300.00', overdueCount: 1 });
    });

    it('lançar já pago cria a despesa e o pagamento numa operação idempotente', async () => {
      const { owner, account } = await setup();
      const settleNow = { accountId: account.id, method: 'CASH', idempotencyKey: key() };
      const body = { description: 'Combustível', categoryId: await categoryId(t, owner, 'FUEL'), amount: '250.00', competence: dates.month(), dueDate: dates.today(), settleNow };
      const first = await payable(owner, body);
      const retry = await payable(owner, body);
      expect(retry.items[0].id).toBe(first.items[0].id);
      expect(first.items[0].status).toBe('PAID');
      expect(await balanceOf(t, owner, account.id)).toBe('750.00');
    });

    it('cancelar exige estornar o pagamento antes; estorno devolve o saldo e não se repete', async () => {
      const { owner, company, account } = await setup();
      const p = (await payable(owner, { description: 'Contador', categoryId: await categoryId(t, owner, 'ACCOUNTING'), amount: '400.00', competence: dates.month(), dueDate: dates.today() })).items[0];
      const paid = await t.http().post(`/api/v1/payables/${p.id}/settlements`).set(bearer(owner)).send({ accountId: account.id, method: 'PIX', idempotencyKey: key() }).expect(201);
      expect(await balanceOf(t, owner, account.id)).toBe('600.00');
      await t.http().post(`/api/v1/payables/${p.id}/cancel`).set(bearer(owner)).send({ reason: 'Duplicado' }).expect(422);

      await t.http().post(`/api/v1/settlements/${paid.body.settlement.id}/reverse`).set(bearer(owner)).send({ reason: 'Pago na conta errada' }).expect(200);
      expect(await balanceOf(t, owner, account.id)).toBe('1000.00');
      await t.http().post(`/api/v1/settlements/${paid.body.settlement.id}/reverse`).set(bearer(owner)).send({ reason: 'Pago na conta errada' }).expect(409);
      const reversal = await t.prisma.accountTransaction.findFirst({ where: { accountId: account.id, kind: 'REVERSAL' } });
      expect(reversal).toMatchObject({ direction: 'IN' });

      const canceled = await t.http().post(`/api/v1/payables/${p.id}/cancel`).set(bearer(owner)).send({ reason: 'Duplicado' }).expect(200);
      expect(canceled.body).toMatchObject({ status: 'CANCELED', openAmount: '0.00', cancelReason: 'Duplicado' });
      expect(await reconciliationIssues(company.id)).toBe(0);
    });
  });

  describe('concorrência em liquidações', () => {
    it('pagamentos paralelos nunca ultrapassam o valor da conta', async () => {
      const { owner, company, account } = await setup();
      const p = (await payable(owner, { description: 'Manutenção', categoryId: await categoryId(t, owner, 'MAINTENANCE'), amount: '1000.00', competence: dates.month(), dueDate: dates.today() })).items[0];
      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          t.http().post(`/api/v1/payables/${p.id}/settlements`).set(bearer(owner)).send({ accountId: account.id, amount: '400.00', method: 'PIX', idempotencyKey: key() }),
        ),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(2);
      expect(results.filter((r) => r.status === 422)).toHaveLength(4);
      const stored = await t.prisma.payable.findUniqueOrThrow({ where: { id: p.id } });
      expect(stored.paidAmount.toFixed(2)).toBe('800.00');
      expect(stored.status).toBe('PARTIALLY_PAID');
      expect(await balanceOf(t, owner, account.id)).toBe('200.00');
      expect(await reconciliationIssues(company.id)).toBe(0);
    });

    it('a mesma chave enviada em paralelo gera um único pagamento', async () => {
      const { owner, account } = await setup();
      const p = (await payable(owner, { description: 'Pedágio', categoryId: await categoryId(t, owner, 'TOLL'), amount: '30.00', competence: dates.month(), dueDate: dates.today() })).items[0];
      const body = { accountId: account.id, amount: '10.00', method: 'CASH', idempotencyKey: key() };
      const results = await Promise.all(Array.from({ length: 5 }, () => t.http().post(`/api/v1/payables/${p.id}/settlements`).set(bearer(owner)).send(body)));
      expect(results.every((r) => r.status === 201)).toBe(true);
      expect(new Set(results.map((r) => r.body.settlement.id)).size).toBe(1);
      expect(await t.prisma.settlement.count({ where: { payableId: p.id } })).toBe(1);
      expect(await balanceOf(t, owner, account.id)).toBe('990.00');
      const reused = await t.http().post(`/api/v1/payables/${p.id}/settlements`).set(bearer(owner)).send({ ...body, amount: '5.00' }).expect(409);
      expect(reused.body.code).toBe('IDEMPOTENCY_CONFLICT');
    });
  });

  describe('bloqueio de período', () => {
    it('mês fechado recusa lançamentos e liquidações daquela data', async () => {
      const { owner, company, account } = await setup();
      const closed = new Date(`${dates.month(-1)}-01T00:00:00Z`);
      await t.prisma.monthlyClosing.create({
        data: { companyId: company.id, year: closed.getUTCFullYear(), month: closed.getUTCMonth() + 1, snapshot: {}, closedById: owner.userId },
      });
      const cat = await categoryId(t, owner, 'WASHING');
      const res = await t.http().post('/api/v1/payables').set(bearer(owner)).send({ description: 'Lavagem', categoryId: cat, amount: '50.00', competence: dates.month(-1), dueDate: dates.today() }).expect(409);
      expect(res.body.code).toBe('PERIOD_CLOSED');
      const p = (await payable(owner, { description: 'Lavagem', categoryId: cat, amount: '50.00', competence: dates.month(), dueDate: dates.today() })).items[0];
      const pay = await t
        .http()
        .post(`/api/v1/payables/${p.id}/settlements`)
        .set(bearer(owner))
        .send({ accountId: account.id, method: 'PIX', settledAt: dates.dayOfMonth(-1, 15), idempotencyKey: key() })
        .expect(409);
      expect(pay.body.code).toBe('PERIOD_CLOSED');
    });
  });

  describe('isolamento entre empresas', () => {
    it('não liquida, edita ou vincula registros de outra empresa', async () => {
      const a = await setup();
      const b = await setup();
      const pa = (await payable(a.owner, { description: 'Da A', categoryId: await categoryId(t, a.owner, 'FUEL'), amount: '100.00', competence: dates.month(), dueDate: dates.today() })).items[0];
      await t.http().get(`/api/v1/payables/${pa.id}`).set(bearer(b.owner)).expect(404);
      await t.http().post(`/api/v1/payables/${pa.id}/settlements`).set(bearer(b.owner)).send({ accountId: b.account.id, method: 'PIX', idempotencyKey: key() }).expect(404);
      await t.http().patch(`/api/v1/payables/${pa.id}`).set(bearer(b.owner)).send({ amount: '1.00' }).expect(404);

      const pb = (await payable(b.owner, { description: 'Da B', categoryId: await categoryId(t, b.owner, 'FUEL'), amount: '100.00', competence: dates.month(), dueDate: dates.today() })).items[0];
      // Conta, categoria e veículo da A não podem ser usados pela B.
      await t.http().post(`/api/v1/payables/${pb.id}/settlements`).set(bearer(b.owner)).send({ accountId: a.account.id, method: 'PIX', idempotencyKey: key() }).expect(404);
      await t.http().post('/api/v1/payables').set(bearer(b.owner)).send({ description: 'X', categoryId: await categoryId(t, a.owner, 'FUEL'), amount: '1.00', competence: dates.month(), dueDate: dates.today() }).expect(400);
      await t.http().post('/api/v1/payables').set(bearer(b.owner)).send({ description: 'Xis', categoryId: await categoryId(t, a.owner, 'FUEL'), amount: '1.00', competence: dates.month(), dueDate: dates.today() }).expect(404);
      const va = await createVehicle(t, a.owner);
      await t.http().patch(`/api/v1/payables/${pb.id}`).set(bearer(b.owner)).send({ vehicleId: va.id }).expect(404);
      await t.http().post(`/api/v1/settlements/${(await t.prisma.settlement.findFirst({ where: { companyId: a.company.id } }))?.id ?? pa.id}/reverse`).set(bearer(b.owner)).send({ reason: 'tentativa indevida' }).expect(404);

      // O banco também recusa vínculo cruzado (FK composta), mesmo sem passar pela API.
      await expect(
        t.prisma.expenseAllocation.create({ data: { companyId: b.company.id, payableId: pb.id, vehicleId: va.id, method: 'DIRECT', amount: new Prisma.Decimal('1.00') } }),
      ).rejects.toThrow();
      expect(await balanceOf(t, a.owner, a.account.id)).toBe('1000.00');
    });

    it('motorista não acessa o financeiro da empresa', async () => {
      const { owner, company } = await setup();
      await t.prisma.subscription.update({ where: { companyId: company.id }, data: { overrideMaxUsers: 10 } });
      const { member: driver } = await addMember(t, owner, 'DRIVER');
      for (const path of ['/api/v1/payables', '/api/v1/receivables', '/api/v1/accounts', '/api/v1/dashboard', '/api/v1/categories']) {
        await t.http().get(path).set(bearer(driver)).expect(403);
      }
      const { member: fin } = await addMember(t, owner, 'FINANCIAL');
      await t.http().get('/api/v1/dashboard').set(bearer(fin)).expect(200);
      await t.http().post('/api/v1/accounts').set(bearer(fin)).send({ name: 'Do financeiro', type: 'CASH', openingBalance: '0.00', openingBalanceDate: dates.today() }).expect(201);
    });
  });

  describe('dashboard e resultado por veículo', () => {
    it('separa caixa de competência e calcula resultado por veículo', async () => {
      const { owner, account } = await setup();
      const v1 = await createVehicle(t, owner, 'Van A');
      const v2 = await createVehicle(t, owner, 'Van B');
      const contract = await categoryId(t, owner, 'CONTRACT');

      // Competência deste mês: receita 12.000 na Van A (recebida 5.000), 3.000 na Van B (não recebida).
      const ra = (await receivable(owner, { description: 'Escola', categoryId: contract, amount: '12000.00', competence: dates.month(), dueDate: dates.today(), vehicleId: v1.id })).items[0];
      await receivable(owner, { description: 'Prefeitura', categoryId: contract, amount: '3000.00', competence: dates.month(), dueDate: dates.daysAhead(3), vehicleId: v2.id });
      await t.http().post(`/api/v1/receivables/${ra.id}/settlements`).set(bearer(owner)).send({ accountId: account.id, amount: '5000.00', method: 'PIX', idempotencyKey: key() }).expect(201);

      // Despesas: combustível 500 na Van A (paga), manutenção 800 na Van B (aberta), contador 400 sem veículo (pago).
      await payable(owner, { description: 'Diesel', categoryId: await categoryId(t, owner, 'FUEL'), amount: '500.00', competence: dates.month(), dueDate: dates.today(), vehicleId: v1.id, settleNow: { accountId: account.id, method: 'CARD', idempotencyKey: key() } });
      await payable(owner, { description: 'Freios', categoryId: await categoryId(t, owner, 'MAINTENANCE'), amount: '800.00', competence: dates.month(), dueDate: dates.daysAgo(1), vehicleId: v2.id });
      await payable(owner, { description: 'Contador', categoryId: await categoryId(t, owner, 'ACCOUNTING'), amount: '400.00', competence: dates.month(), dueDate: dates.today(), settleNow: { accountId: account.id, method: 'PIX', idempotencyKey: key() } });

      const d = (await t.http().get('/api/v1/dashboard').set(bearer(owner)).expect(200)).body;
      expect(d.balances.total).toBe('5100.00'); // 1000 + 5000 − 500 − 400
      expect(d.cash).toEqual({ regime: 'CASH', received: '5000.00', paid: '900.00', result: '4100.00' });
      expect(d.accrual).toEqual({ regime: 'ACCRUAL', revenue: '15000.00', expense: '1700.00', result: '13300.00' });
      expect(d.receivables).toMatchObject({ open: '10000.00', openCount: 2 });
      expect(d.payables).toMatchObject({ open: '800.00', overdue: '800.00', overdueCount: 1 });
      expect(d.vehicles.active).toBe(2);
      const byName = Object.fromEntries((d.vehicles.results as { name: string; revenue: string; cost: string; result: string }[]).map((r) => [r.name, r]));
      expect(byName['Van A']).toMatchObject({ revenue: '12000.00', cost: '500.00', result: '11500.00' });
      expect(byName['Van B']).toMatchObject({ revenue: '3000.00', cost: '800.00', result: '2200.00' });
      expect(byName['Não alocado']).toMatchObject({ revenue: '0.00', cost: '400.00', result: '-400.00' });
      expect(d.vehicles.costPerVehicle).toBe('650.00');
      const current = d.monthly.find((m: { month: string }) => m.month === dates.month());
      expect(current).toMatchObject({ fuel: '500.00', maintenance: '800.00', revenue: '15000.00', expense: '1700.00' });
      expect(d.expensesByCategory.map((c: { name: string }) => c.name)).toEqual(['Manutenção', 'Combustível', 'Contabilidade']);

      // Filtro por veículo: só o que foi atribuído à Van A (caixa proporcional).
      const fa = (await t.http().get(`/api/v1/dashboard?vehicleId=${v1.id}`).set(bearer(owner)).expect(200)).body;
      expect(fa.accrual).toMatchObject({ revenue: '12000.00', expense: '500.00' });
      expect(fa.cash).toMatchObject({ received: '5000.00', paid: '500.00' });

      const detail = (await t.http().get(`/api/v1/vehicles/${v1.id}`).set(bearer(owner)).expect(200)).body;
      expect(detail.financial).toMatchObject({ revenue: '12000.00', directCost: '500.00', sharedCost: '0.00', result: '11500.00' });
      expect(detail.hasHistory).toBe(true);
    });
  });
});
