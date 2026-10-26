import {
  addMember,
  balanceOf,
  bearer,
  createAccount,
  createTestApp,
  createVehicle,
  dates,
  key,
  nextPlate,
  ownerWithCompany,
  resetDb,
  type TestApp,
} from './helpers';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

describe('Veículos, categorias, contas, transferências e comprovantes (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
    await resetDb(t.prisma);
  });
  afterAll(() => t.close());

  describe('veículos', () => {
    it('cadastra veículo normalizando a placa e recusa placa duplicada', async () => {
      const { owner } = await ownerWithCompany(t);
      const res = await t
        .http()
        .post('/api/v1/vehicles')
        .set(bearer(owner))
        .send({ name: 'Van 01', plate: 'abc-1d23', brand: 'Mercedes', model: 'Sprinter', year: 2022, odometerKm: 85000 })
        .expect(201);
      expect(res.body).toMatchObject({ name: 'Van 01', plate: 'ABC1D23', status: 'ACTIVE', odometerKm: 85000 });
      await t.http().post('/api/v1/vehicles').set(bearer(owner)).send({ name: 'Outra', plate: 'ABC1D23' }).expect(409);
      await t.http().post('/api/v1/vehicles').set(bearer(owner)).send({ name: 'Inválida', plate: 'AB12' }).expect(400);
      expect(await t.prisma.auditLog.count({ where: { action: 'vehicle.created', entityId: res.body.id } })).toBe(1);
    });

    it('respeita o limite de veículos do plano e arquivar libera a vaga', async () => {
      const { owner } = await ownerWithCompany(t);
      const a = await createVehicle(t, owner, 'A');
      await createVehicle(t, owner, 'B');
      const blocked = await t.http().post('/api/v1/vehicles').set(bearer(owner)).send({ name: 'C', plate: nextPlate() }).expect(409);
      expect(blocked.body.code).toBe('PLAN_LIMIT_REACHED');

      const list = await t.http().get('/api/v1/vehicles').set(bearer(owner)).expect(200);
      expect(list.body.usage).toEqual({ used: 2, limit: 2 });

      await t.http().post(`/api/v1/vehicles/${a.id}/archive`).set(bearer(owner)).expect(200);
      await t.http().post('/api/v1/vehicles').set(bearer(owner)).send({ name: 'C', plate: nextPlate() }).expect(201);
      // Reativar o arquivado esbarra no limite de novo.
      const restore = await t.http().post(`/api/v1/vehicles/${a.id}/restore`).set(bearer(owner)).expect(409);
      expect(restore.body.code).toBe('PLAN_LIMIT_REACHED');
    });

    it('limite de veículos vale sob concorrência', async () => {
      const { owner } = await ownerWithCompany(t);
      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) => t.http().post('/api/v1/vehicles').set(bearer(owner)).send({ name: `V${i}`, plate: nextPlate() })),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(2);
      expect(results.filter((r) => r.status === 409)).toHaveLength(3);
    });

    it('não exclui veículo com histórico financeiro; sem histórico, exclui', async () => {
      const { owner } = await ownerWithCompany(t);
      const free = await createVehicle(t, owner, 'Sem histórico');
      await t.http().delete(`/api/v1/vehicles/${free.id}`).set(bearer(owner)).expect(204);

      const used = await createVehicle(t, owner, 'Com histórico');
      const cat = (await t.http().get('/api/v1/categories?type=EXPENSE').set(bearer(owner))).body[0].id;
      await t
        .http()
        .post('/api/v1/payables')
        .set(bearer(owner))
        .send({ description: 'Pneu', categoryId: cat, amount: '800.00', competence: dates.month(), dueDate: dates.today(), vehicleId: used.id })
        .expect(201);
      const res = await t.http().delete(`/api/v1/vehicles/${used.id}`).set(bearer(owner)).expect(409);
      expect(res.body.message).toMatch(/Arquive/);
    });

    it('isola veículos entre empresas e aplica permissões', async () => {
      const a = await ownerWithCompany(t, 'Empresa A');
      const b = await ownerWithCompany(t, 'Empresa B');
      const va = await createVehicle(t, a.owner);
      await t.http().get(`/api/v1/vehicles/${va.id}`).set(bearer(b.owner)).expect(404);
      await t.http().patch(`/api/v1/vehicles/${va.id}`).set(bearer(b.owner)).send({ name: 'Roubada' }).expect(404);
      expect((await t.http().get('/api/v1/vehicles').set(bearer(b.owner))).body.items).toHaveLength(0);

      await t.prisma.subscription.update({ where: { companyId: a.company.id }, data: { overrideMaxUsers: 10 } });
      const { member: driver } = await addMember(t, a.owner, 'DRIVER');
      await t.http().get('/api/v1/vehicles').set(bearer(driver)).expect(403);
      const { member: manager } = await addMember(t, a.owner, 'MANAGER');
      await t.http().post('/api/v1/vehicles').set(bearer(manager)).send({ name: 'Do gestor', plate: nextPlate() }).expect(201);
      // Gestor vê o cadastro, mas sem finance:read não vê o resultado financeiro.
      const detail = await t.http().get(`/api/v1/vehicles/${va.id}`).set(bearer(manager)).expect(200);
      expect(detail.body.financial).toBeNull();
    });
  });

  describe('categorias', () => {
    it('cria as categorias padrão e permite personalizadas', async () => {
      const { owner } = await ownerWithCompany(t);
      const all = await t.http().get('/api/v1/categories').set(bearer(owner)).expect(200);
      const keys = (all.body as { systemKey: string | null }[]).map((c) => c.systemKey);
      for (const k of ['FUEL', 'MAINTENANCE', 'PARTS', 'TIRES', 'TIRE_REPAIR', 'SALARY', 'TRACKER', 'ACCOUNTING', 'BANK_FEES', 'INSURANCE', 'TAXES', 'LICENSING', 'WASHING', 'TOLL', 'OTHER_EXPENSE']) {
        expect(keys).toContain(k);
      }
      const created = await t.http().post('/api/v1/categories').set(bearer(owner)).send({ type: 'EXPENSE', name: 'Monitora' }).expect(201);
      expect(created.body.systemKey).toBeNull();
      await t.http().post('/api/v1/categories').set(bearer(owner)).send({ type: 'EXPENSE', name: 'monitora' }).expect(409);

      const fuel = (all.body as { id: string; systemKey: string }[]).find((c) => c.systemKey === 'FUEL')!;
      await t.http().patch(`/api/v1/categories/${fuel.id}`).set(bearer(owner)).send({ name: 'Gasolina' }).expect(400);
      await t.http().patch(`/api/v1/categories/${created.body.id}`).set(bearer(owner)).send({ status: 'INACTIVE' }).expect(200);
      const res = await t
        .http()
        .post('/api/v1/payables')
        .set(bearer(owner))
        .send({ description: 'Xis', categoryId: created.body.id, amount: '10.00', competence: dates.month(), dueDate: dates.today() })
        .expect(400);
      expect(res.body.message).toMatch(/desativada/);
    });
  });

  describe('contas financeiras', () => {
    it('saldo inicial entra no razão e o saldo é Σ entradas − Σ saídas', async () => {
      const { owner } = await ownerWithCompany(t);
      const acc = await createAccount(t, owner, 'Banco', '2500.00');
      expect(acc.balance).toBe('2500.00');
      const tx = await t.prisma.accountTransaction.findMany({ where: { accountId: acc.id } });
      expect(tx).toHaveLength(1);
      expect(tx[0]).toMatchObject({ kind: 'OPENING_BALANCE', direction: 'IN' });

      const negative = await createAccount(t, owner, 'Cheque especial', '-150.30');
      expect(negative.balance).toBe('-150.30');
      const list = await t.http().get('/api/v1/accounts').set(bearer(owner)).expect(200);
      expect(list.body.totalBalance).toBe('2349.70');

      // Corrigir o saldo inicial atualiza o próprio lançamento de abertura.
      await t.http().patch(`/api/v1/accounts/${acc.id}`).set(bearer(owner)).send({ openingBalance: '3000.00' }).expect(200);
      expect(await balanceOf(t, owner, acc.id)).toBe('3000.00');
      await t.http().post('/api/v1/accounts').set(bearer(owner)).send({ name: 'Futura', type: 'CASH', openingBalance: '1.00', openingBalanceDate: dates.daysAhead(3) }).expect(400);
    });

    it('ajuste exige permissão própria e justificativa, e fica auditado', async () => {
      const { owner } = await ownerWithCompany(t);
      const acc = await createAccount(t, owner, 'Caixa', '100.00');
      await t.prisma.subscription.updateMany({ data: { overrideMaxUsers: 10 } });
      const { member: fin } = await addMember(t, owner, 'FINANCIAL');
      const body = { direction: 'OUT', amount: '20.00', occurredAt: dates.today(), reason: 'Diferença de conciliação do caixa' };
      await t.http().post(`/api/v1/accounts/${acc.id}/adjustments`).set(bearer(fin)).send(body).expect(403);
      await t.http().post(`/api/v1/accounts/${acc.id}/adjustments`).set(bearer(owner)).send({ ...body, reason: 'curta' }).expect(400);
      const res = await t.http().post(`/api/v1/accounts/${acc.id}/adjustments`).set(bearer(owner)).send(body).expect(201);
      expect(res.body.balance).toBe('80.00');
      expect(await t.prisma.auditLog.count({ where: { action: 'account.adjusted', reason: body.reason } })).toBe(1);
    });

    it('não desativa conta com saldo', async () => {
      const { owner } = await ownerWithCompany(t);
      const acc = await createAccount(t, owner, 'Poupança', '10.00');
      const res = await t.http().patch(`/api/v1/accounts/${acc.id}`).set(bearer(owner)).send({ status: 'INACTIVE' }).expect(422);
      expect(res.body.code).toBe('BUSINESS_RULE');
    });

    it('o razão é imutável no banco', async () => {
      const { owner } = await ownerWithCompany(t);
      const acc = await createAccount(t, owner, 'Imutável', '50.00');
      await expect(t.prisma.accountTransaction.deleteMany({ where: { accountId: acc.id } })).rejects.toThrow();
    });
  });

  describe('transferências', () => {
    it('move saldo entre contas sem alterar o total, é idempotente e pode ser estornada', async () => {
      const { owner } = await ownerWithCompany(t);
      const from = await createAccount(t, owner, 'Banco', '1000.00');
      const to = await createAccount(t, owner, 'Caixa', '0.00');
      const body = { fromAccountId: from.id, toAccountId: to.id, amount: '300.00', transferredAt: dates.today(), idempotencyKey: key() };
      const first = await t.http().post('/api/v1/transfers').set(bearer(owner)).send(body).expect(201);
      const again = await t.http().post('/api/v1/transfers').set(bearer(owner)).send(body).expect(201);
      expect(again.body.id).toBe(first.body.id);
      expect(await balanceOf(t, owner, from.id)).toBe('700.00');
      expect(await balanceOf(t, owner, to.id)).toBe('300.00');
      expect((await t.http().get('/api/v1/accounts').set(bearer(owner))).body.totalBalance).toBe('1000.00');

      const reused = await t.http().post('/api/v1/transfers').set(bearer(owner)).send({ ...body, amount: '1.00' }).expect(409);
      expect(reused.body.code).toBe('IDEMPOTENCY_CONFLICT');
      await t.http().post('/api/v1/transfers').set(bearer(owner)).send({ ...body, toAccountId: from.id, idempotencyKey: key() }).expect(400);

      // Transferência não é receita nem despesa.
      const dash = await t.http().get('/api/v1/dashboard').set(bearer(owner)).expect(200);
      expect(dash.body.cash).toMatchObject({ received: '0.00', paid: '0.00' });

      await t.http().post(`/api/v1/transfers/${first.body.id}/reverse`).set(bearer(owner)).send({ reason: 'Conta de destino errada' }).expect(200);
      expect(await balanceOf(t, owner, from.id)).toBe('1000.00');
      expect(await balanceOf(t, owner, to.id)).toBe('0.00');
      await t.http().post(`/api/v1/transfers/${first.body.id}/reverse`).set(bearer(owner)).send({ reason: 'Conta de destino errada' }).expect(409);
    });

    it('transferências paralelas com a mesma chave geram uma só', async () => {
      const { owner } = await ownerWithCompany(t);
      const from = await createAccount(t, owner, 'Banco', '1000.00');
      const to = await createAccount(t, owner, 'Caixa', '0.00');
      const body = { fromAccountId: from.id, toAccountId: to.id, amount: '50.00', transferredAt: dates.today(), idempotencyKey: key() };
      const res = await Promise.all(Array.from({ length: 4 }, () => t.http().post('/api/v1/transfers').set(bearer(owner)).send(body)));
      expect(res.every((r) => r.status === 201)).toBe(true);
      expect(new Set(res.map((r) => r.body.id)).size).toBe(1);
      expect(await balanceOf(t, owner, to.id)).toBe('50.00');
    });

    it('não transfere usando conta de outra empresa', async () => {
      const a = await ownerWithCompany(t);
      const b = await ownerWithCompany(t);
      const accA = await createAccount(t, a.owner, 'Conta A', '100.00');
      const accB = await createAccount(t, b.owner, 'Conta B', '100.00');
      await t
        .http()
        .post('/api/v1/transfers')
        .set(bearer(b.owner))
        .send({ fromAccountId: accA.id, toAccountId: accB.id, amount: '10.00', transferredAt: dates.today(), idempotencyKey: key() })
        .expect(404);
      expect(await balanceOf(t, a.owner, accA.id)).toBe('100.00');
    });
  });

  describe('comprovantes', () => {
    it('anexa, baixa e remove comprovante só dentro da empresa', async () => {
      const a = await ownerWithCompany(t);
      const b = await ownerWithCompany(t);
      const cat = (await t.http().get('/api/v1/categories?type=EXPENSE').set(bearer(a.owner))).body[0].id;
      const created = await t
        .http()
        .post('/api/v1/payables')
        .set(bearer(a.owner))
        .send({ description: 'Borracharia', categoryId: cat, amount: '60.00', competence: dates.month(), dueDate: dates.today() })
        .expect(201);
      const payableId = created.body.items[0].id;

      const up = await t.http().post('/api/v1/attachments').set(bearer(a.owner)).field('payableId', payableId).attach('file', PDF, 'nota fiscal.pdf').expect(201);
      expect(up.body).toMatchObject({ originalName: 'nota fiscal.pdf', mimeType: 'application/pdf', sizeBytes: PDF.length });

      const down = await t.http().get(`/api/v1/attachments/${up.body.id}/download`).set(bearer(a.owner)).buffer(true).parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
      expect(down.status).toBe(200);
      expect(down.headers['content-type']).toBe('application/pdf');
      expect(Buffer.compare(down.body as Buffer, PDF)).toBe(0);

      await t.http().get(`/api/v1/attachments/${up.body.id}/download`).set(bearer(b.owner)).expect(404);
      await t.http().post('/api/v1/attachments').set(bearer(b.owner)).field('payableId', payableId).attach('file', PDF, 'x.pdf').expect(404);

      // Tipo validado pelo conteúdo, não pelo nome.
      await t.http().post('/api/v1/attachments').set(bearer(a.owner)).field('payableId', payableId).attach('file', Buffer.from('<script>alert(1)</script>'), 'nota.pdf').expect(400);

      const detail = await t.http().get(`/api/v1/payables/${payableId}`).set(bearer(a.owner)).expect(200);
      expect(detail.body.attachments).toHaveLength(1);
      await t.http().delete(`/api/v1/attachments/${up.body.id}`).set(bearer(a.owner)).expect(204);
      await t.http().get(`/api/v1/attachments/${up.body.id}/download`).set(bearer(a.owner)).expect(404);
    });
  });
});
