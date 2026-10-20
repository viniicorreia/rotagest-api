import { addMember, bearer, categoryId, createAccount, createTestApp, createVehicle, dates, key, ownerWithCompany, resetDb, type Session, type TestApp } from './helpers';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

describe('Rateio, contratos, manutenção, abastecimento e despesas do motorista (e2e)', () => {
  let t: TestApp;
  let owner: Session;
  let v1: { id: string; name: string };
  let v2: { id: string; name: string };
  let accountId: string;

  beforeAll(async () => {
    t = await createTestApp();
    await resetDb(t.prisma);
    ({ owner } = await ownerWithCompany(t, 'Transporte Escolar Teste'));
    v1 = await createVehicle(t, owner, 'Van 01');
    v2 = await createVehicle(t, owner, 'Van 02');
    accountId = (await createAccount(t, owner, 'Caixa', '5000.00')).id;
  });
  afterAll(() => t.close());

  const allocationsOf = async (kind: 'payables' | 'receivables', id: string) => {
    const res = await t.http().get(`/api/v1/${kind}/${id}`).set(bearer(owner)).expect(200);
    return (res.body.allocations as { vehicle: { id: string }; method: string; amount: string }[])
      .map((a) => ({ vehicleId: a.vehicle.id, method: a.method, amount: a.amount }))
      .sort((a, b) => b.amount.localeCompare(a.amount, undefined, { numeric: true }));
  };

  describe('rateio de despesas entre veículos', () => {
    it('divide por percentual sem perder centavos e reaplica ao mudar o valor', async () => {
      const cat = await categoryId(t, owner, 'TRACKER');
      const res = await t
        .http()
        .post('/api/v1/payables')
        .set(bearer(owner))
        .send({
          description: 'Rastreador da frota',
          categoryId: cat,
          amount: '1000.01',
          competence: dates.month(),
          dueDate: dates.today(),
          allocationMethod: 'PERCENT',
          allocations: [
            { vehicleId: v1.id, percent: '70' },
            { vehicleId: v2.id, percent: '30' },
          ],
        })
        .expect(201);
      const p = res.body.items[0];
      expect(p.splitVehicles).toBe(2);
      expect(await allocationsOf('payables', p.id)).toEqual([
        { vehicleId: v1.id, method: 'PERCENT', amount: '700.01' },
        { vehicleId: v2.id, method: 'PERCENT', amount: '300.00' },
      ]);

      await t.http().patch(`/api/v1/payables/${p.id}`).set(bearer(owner)).send({ amount: '2000.00' }).expect(200);
      expect((await allocationsOf('payables', p.id)).map((a) => a.amount)).toEqual(['1400.00', '600.00']);

      // Aparece no filtro de qualquer um dos veículos.
      const byV2 = await t.http().get(`/api/v1/payables?vehicleId=${v2.id}`).set(bearer(owner)).expect(200);
      expect(byV2.body.items.map((i: { id: string }) => i.id)).toContain(p.id);
    });

    it('divide igualmente e valida percentuais e veículo duplicado', async () => {
      const cat = await categoryId(t, owner, 'INSURANCE');
      const body = { description: 'Seguro', categoryId: cat, amount: '100.01', competence: dates.month(), dueDate: dates.today() };
      const res = await t
        .http()
        .post('/api/v1/payables')
        .set(bearer(owner))
        .send({ ...body, allocationMethod: 'EQUAL', allocations: [{ vehicleId: v1.id }, { vehicleId: v2.id }] })
        .expect(201);
      expect((await allocationsOf('payables', res.body.items[0].id)).map((a) => a.amount)).toEqual(['50.01', '50.00']);
      // Igual continua igual quando o valor muda.
      await t.http().patch(`/api/v1/payables/${res.body.items[0].id}`).set(bearer(owner)).send({ amount: '90.00' }).expect(200);
      expect((await allocationsOf('payables', res.body.items[0].id)).map((a) => a.amount)).toEqual(['45.00', '45.00']);

      await t
        .http()
        .post('/api/v1/payables')
        .set(bearer(owner))
        .send({ ...body, allocationMethod: 'PERCENT', allocations: [{ vehicleId: v1.id, percent: '50' }, { vehicleId: v2.id, percent: '40' }] })
        .expect(400);
      await t
        .http()
        .post('/api/v1/payables')
        .set(bearer(owner))
        .send({ ...body, allocationMethod: 'EQUAL', allocations: [{ vehicleId: v1.id }, { vehicleId: v1.id }] })
        .expect(400);
      await t
        .http()
        .post('/api/v1/payables')
        .set(bearer(owner))
        .send({ ...body, vehicleId: v1.id, allocationMethod: 'EQUAL', allocations: [{ vehicleId: v1.id }, { vehicleId: v2.id }] })
        .expect(400);
    });
  });

  describe('contratantes e contratos', () => {
    let contractId: string;

    it('gera as contas a receber do contrato ativo por competência, rateadas pelos veículos', async () => {
      const contractor = await t.http().post('/api/v1/contractors').set(bearer(owner)).send({ name: 'Escola Municipal Aurora', kind: 'SCHOOL' }).expect(201);
      const contract = await t
        .http()
        .post('/api/v1/contracts')
        .set(bearer(owner))
        .send({
          contractorId: contractor.body.id,
          description: 'Transporte escolar 2026',
          amount: '3000.00',
          startDate: dates.dayOfMonth(0, 1),
          dueDay: 10,
          dueMonthOffset: 0,
          vehicles: [
            { vehicleId: v1.id, sharePercent: '60' },
            { vehicleId: v2.id, sharePercent: '40' },
          ],
        })
        .expect(201);
      contractId = contract.body.id;
      expect(contract.body.status).toBe('DRAFT');

      // Rascunho não gera nada.
      const draft = await t.http().get(`/api/v1/contracts/${contractId}`).set(bearer(owner)).expect(200);
      expect(draft.body.receivables).toHaveLength(0);

      await t.http().post(`/api/v1/contracts/${contractId}/status`).set(bearer(owner)).send({ status: 'ACTIVE' }).expect(200);
      const active = await t.http().get(`/api/v1/contracts/${contractId}`).set(bearer(owner)).expect(200);
      const competences = active.body.receivables.map((r: { competence: string }) => r.competence).sort();
      expect(competences).toEqual([dates.month(), dates.month(1)]);
      const current = active.body.receivables.find((r: { competence: string }) => r.competence === dates.month());
      expect(current).toMatchObject({ amount: '3000.00', dueDate: dates.dayOfMonth(0, 10) });
      expect((await allocationsOf('receivables', current.id)).map((a) => a.amount)).toEqual(['1800.00', '1200.00']);

      // Gerar de novo não duplica.
      await t.http().get('/api/v1/receivables').set(bearer(owner)).expect(200);
      const again = await t.http().get(`/api/v1/contracts/${contractId}`).set(bearer(owner)).expect(200);
      expect(again.body.receivables).toHaveLength(2);

      // Contrato ativo não muda valor retroativamente.
      await t.http().post(`/api/v1/contracts/${contractId}/status`).set(bearer(owner)).send({ status: 'DRAFT' }).expect(400);
    });

    it('encerrar cancela as cobranças futuras ainda em aberto', async () => {
      await t.http().post(`/api/v1/contracts/${contractId}/status`).set(bearer(owner)).send({ status: 'ENDED', endDate: dates.dayOfMonth(0, 28), reason: 'Fim do ano letivo' }).expect(200);
      const ended = await t.http().get(`/api/v1/contracts/${contractId}`).set(bearer(owner)).expect(200);
      const byMonth = Object.fromEntries(ended.body.receivables.map((r: { competence: string; status: string }) => [r.competence, r.status]));
      expect(byMonth[dates.month()]).toBe('PENDING');
      expect(byMonth[dates.month(1)]).toBe('CANCELED');
    });

    it('outra empresa não enxerga contratos nem contratantes', async () => {
      const other = await ownerWithCompany(t, 'Concorrente');
      await t.http().get(`/api/v1/contracts/${contractId}`).set(bearer(other.owner)).expect(404);
      const list = await t.http().get('/api/v1/contractors').set(bearer(other.owner)).expect(200);
      expect(list.body).toHaveLength(0);
      const foreign = await t.http().post('/api/v1/contractors').set(bearer(other.owner)).send({ name: 'Deles' }).expect(201);
      await t
        .http()
        .post('/api/v1/contracts')
        .set(bearer(owner))
        .send({ contractorId: foreign.body.id, amount: '10.00', startDate: dates.today() })
        .expect(404);
    });
  });

  describe('manutenção e abastecimento', () => {
    it('manutenção gera a conta a pagar do veículo e pode nascer paga', async () => {
      const res = await t
        .http()
        .post('/api/v1/maintenances')
        .set(bearer(owner))
        .send({
          vehicleId: v1.id,
          type: 'OIL_CHANGE',
          description: 'Óleo e filtros',
          date: dates.today(),
          amount: '450.00',
          odometerKm: 50200,
          supplierName: 'Oficina do João',
          settleNow: { accountId, method: 'PIX', idempotencyKey: key() },
        })
        .expect(201);
      expect(res.body).toMatchObject({ type: 'OIL_CHANGE', amount: '450.00', payable: { status: 'PAID', approvalStatus: 'APPROVED', paidAmount: '450.00' } });
      expect(await allocationsOf('payables', res.body.payable.id)).toEqual([{ vehicleId: v1.id, method: 'DIRECT', amount: '450.00' }]);
      const v = await t.http().get(`/api/v1/vehicles/${v1.id}`).set(bearer(owner)).expect(200);
      expect(v.body.odometerKm).toBe(50200);

      const pending = await t.http().post('/api/v1/maintenances').set(bearer(owner)).send({ vehicleId: v2.id, type: 'TIRES', description: '2 pneus', date: dates.today(), amount: '1200.00' }).expect(201);
      const payable = await t.http().get(`/api/v1/payables/${pending.body.payable.id}`).set(bearer(owner)).expect(200);
      expect(payable.body.category.systemKey).toBe('TIRES');

      const canceled = await t.http().post(`/api/v1/maintenances/${pending.body.id}/cancel`).set(bearer(owner)).send({ reason: 'Lançado errado' }).expect(200);
      expect(canceled.body.payable.status).toBe('CANCELED');
      // Paga não cancela sem estornar.
      await t.http().post(`/api/v1/maintenances/${res.body.id}/cancel`).set(bearer(owner)).send({ reason: 'Teste' }).expect(422);

      const list = await t.http().get(`/api/v1/maintenances?month=${dates.month()}`).set(bearer(owner)).expect(200);
      expect(list.body).toMatchObject({ total: 2, amount: '450.00' });
    });

    it('abastecimento calcula litros × preço e alimenta km/l e custo por km', async () => {
      const res = await t
        .http()
        .post('/api/v1/fuelings')
        .set(bearer(owner))
        .send({ vehicleId: v1.id, date: dates.today(), liters: '45.32', pricePerLiter: '6.099', station: 'Posto Central' })
        .expect(201);
      expect(res.body).toMatchObject({ liters: '45.320', pricePerLiter: '6.099', amount: '276.41', fuelType: 'DIESEL', payable: { status: 'PENDING' } });

      // Total da nota prevalece quando informado.
      const nota = await t.http().post('/api/v1/fuelings').set(bearer(owner)).send({ vehicleId: v1.id, date: dates.today(), liters: '10', pricePerLiter: '6', amount: '59.99' }).expect(201);
      expect(nota.body.amount).toBe('59.99');

      await t.http().patch(`/api/v1/vehicles/${v1.id}`).set(bearer(owner)).send({ ratePerKm: '3.5' }).expect(200);
      await t.http().post('/api/v1/daily-logs').set(bearer(owner)).send({ vehicleId: v1.id, date: dates.today(), kmDriven: '400' }).expect(201);

      const s = await t.http().get(`/api/v1/fleet-costs/summary?month=${dates.month()}`).set(bearer(owner)).expect(200);
      const row = s.body.vehicles.find((r: { vehicle: { id: string } }) => r.vehicle.id === v1.id);
      // 400 km / 55,32 L; (276,41 + 59,99 + 450,00) / 400 km
      expect(row).toMatchObject({ km: '400.0', kmRevenue: '1400.00', liters: '55.320', fuelCost: '336.40', maintenanceCost: '450.00', kmPerLiter: '7.23', costPerKm: '1.9660' });
    });
  });

  describe('despesas do motorista com aprovação', () => {
    let driverUser: Session;
    let expenseId: string;

    beforeAll(async () => {
      const { member, memberId } = await addMember(t, owner, 'DRIVER');
      driverUser = member;
      const driver = await t.http().post('/api/v1/drivers').set(bearer(owner)).send({ name: 'Maria Motorista', document: '11144477735', memberId }).expect(201);
      const route = await t.http().post('/api/v1/routes').set(bearer(owner)).send({ name: 'Rota Aurora', transportType: 'SCHOOL' }).expect(201);
      await t.http().post('/api/v1/assignments').set(bearer(owner)).send({ routeId: route.body.id, vehicleId: v2.id, driverId: driver.body.id, startDate: dates.daysAgo(10) }).expect(201);
    });

    it('motorista envia despesa com abastecimento e comprovante; fica fora dos números até aprovar', async () => {
      const cats = await t.http().get('/api/v1/my/expense-categories').set(bearer(driverUser)).expect(200);
      const fuelCat = cats.body.items.find((c: { systemKey: string }) => c.systemKey === 'FUEL');
      expect(cats.body.items.some((c: { systemKey: string }) => c.systemKey === 'SALARY')).toBe(false);

      // Só no veículo em que está escalado.
      await t
        .http()
        .post('/api/v1/my/expenses')
        .set(bearer(driverUser))
        .send({ date: dates.today(), categoryId: fuelCat.id, amount: '200.00', description: 'Diesel', vehicleId: v1.id })
        .expect(403);

      const res = await t
        .http()
        .post('/api/v1/my/expenses')
        .set(bearer(driverUser))
        .send({ date: dates.today(), categoryId: fuelCat.id, amount: '200.00', description: 'Diesel na estrada', vehicleId: v2.id, fuel: { liters: '33.3', pricePerLiter: '6.006' } })
        .expect(201);
      expenseId = res.body.id;
      expect(res.body).toMatchObject({ approvalStatus: 'PENDING_APPROVAL', status: 'PENDING', driver: { name: 'Maria Motorista' }, fuel: { liters: '33.300' } });

      await t.http().post('/api/v1/attachments').set(bearer(driverUser)).field('payableId', expenseId).attach('file', PDF, 'cupom.pdf').expect(201);

      const mine = await t.http().get('/api/v1/my/expenses').set(bearer(driverUser)).expect(200);
      expect(mine.body.items).toHaveLength(1);
      expect(mine.body.items[0].attachmentsCount).toBe(1);
      // Quem aprova (sem acesso ao financeiro) vê e baixa o comprovante.
      await t.prisma.subscription.updateMany({ data: { overrideMaxUsers: 10 } });
      const { member: approver } = await addMember(t, owner, 'MANAGER');
      const queue = await t.http().get('/api/v1/expense-approvals').set(bearer(approver)).expect(200);
      const att = queue.body.items[0].attachments[0];
      expect(att.originalName).toBe('cupom.pdf');
      await t.http().get(`/api/v1/attachments/${att.id}/download`).set(bearer(approver)).expect(200);

      // Fora da lista padrão de contas a pagar e dos resumos de combustível; não pode ser paga.
      const payables = await t.http().get('/api/v1/payables').set(bearer(owner)).expect(200);
      expect(payables.body.items.map((i: { id: string }) => i.id)).not.toContain(expenseId);
      const pendingList = await t.http().get('/api/v1/payables?approval=PENDING_APPROVAL').set(bearer(owner)).expect(200);
      expect(pendingList.body.items.map((i: { id: string }) => i.id)).toEqual([expenseId]);
      await t.http().post(`/api/v1/payables/${expenseId}/settlements`).set(bearer(owner)).send({ accountId, method: 'PIX', idempotencyKey: key() }).expect(422);
      const s = await t.http().get(`/api/v1/fleet-costs/summary?month=${dates.month()}`).set(bearer(owner)).expect(200);
      expect(s.body.vehicles.find((r: { vehicle: { id: string } }) => r.vehicle.id === v2.id).fuelCost).toBe('0.00');
    });

    it('motorista não vê o financeiro nem despesas dos outros', async () => {
      await t.http().get('/api/v1/payables').set(bearer(driverUser)).expect(403);
      await t.http().get('/api/v1/expense-approvals').set(bearer(driverUser)).expect(403);
      await t.http().post(`/api/v1/expense-approvals/${expenseId}/approve`).set(bearer(driverUser)).expect(403);
      const other = await t.http().post('/api/v1/payables').set(bearer(owner)).send({ description: 'Do gestor', categoryId: await categoryId(t, owner, 'TOLL'), amount: '10.00', competence: dates.month(), dueDate: dates.today() }).expect(201);
      await t.http().post('/api/v1/attachments').set(bearer(driverUser)).field('payableId', other.body.items[0].id).attach('file', PDF, 'x.pdf').expect(403);
    });

    it('gestor aprova; depois disso o motorista não mexe mais', async () => {
      const queue = await t.http().get('/api/v1/expense-approvals').set(bearer(owner)).expect(200);
      expect(queue.body.items.map((i: { id: string }) => i.id)).toEqual([expenseId]);

      const ok = await t.http().post(`/api/v1/expense-approvals/${expenseId}/approve`).set(bearer(owner)).expect(200);
      expect(ok.body.approvalStatus).toBe('APPROVED');
      await t.http().post(`/api/v1/expense-approvals/${expenseId}/approve`).set(bearer(owner)).expect(422);
      await t.http().post(`/api/v1/my/expenses/${expenseId}/withdraw`).set(bearer(driverUser)).expect(422);
      await t.http().post('/api/v1/attachments').set(bearer(driverUser)).field('payableId', expenseId).attach('file', PDF, 'outro.pdf').expect(403);

      const s = await t.http().get(`/api/v1/fleet-costs/summary?month=${dates.month()}`).set(bearer(owner)).expect(200);
      expect(s.body.vehicles.find((r: { vehicle: { id: string } }) => r.vehicle.id === v2.id)).toMatchObject({ fuelCost: '200.00', liters: '33.300' });
      await t.http().post(`/api/v1/payables/${expenseId}/settlements`).set(bearer(owner)).send({ accountId, method: 'PIX', idempotencyKey: key() }).expect(201);
    });

    it('gestor recusa com motivo e o motorista pode retirar a que ainda não foi analisada', async () => {
      const cats = await t.http().get('/api/v1/my/expense-categories').set(bearer(driverUser)).expect(200);
      const toll = cats.body.items.find((c: { systemKey: string }) => c.systemKey === 'TOLL');
      const a = await t.http().post('/api/v1/my/expenses').set(bearer(driverUser)).send({ date: dates.today(), categoryId: toll.id, amount: '15.00', description: 'Pedágio' }).expect(201);
      const b = await t.http().post('/api/v1/my/expenses').set(bearer(driverUser)).send({ date: dates.today(), categoryId: toll.id, amount: '15.00', description: 'Pedágio repetido' }).expect(201);

      await t.http().post(`/api/v1/expense-approvals/${a.body.id}/reject`).set(bearer(owner)).send({ reason: 'x' }).expect(400);
      const rejected = await t.http().post(`/api/v1/expense-approvals/${a.body.id}/reject`).set(bearer(owner)).send({ reason: 'Sem comprovante' }).expect(200);
      expect(rejected.body).toMatchObject({ approvalStatus: 'REJECTED', status: 'CANCELED', cancelReason: 'Sem comprovante' });

      const withdrawn = await t.http().post(`/api/v1/my/expenses/${b.body.id}/withdraw`).set(bearer(driverUser)).expect(200);
      expect(withdrawn.body.status).toBe('CANCELED');
      const queue = await t.http().get('/api/v1/expense-approvals').set(bearer(owner)).expect(200);
      expect(queue.body.items).toHaveLength(0);
    });

    it('usuário sem cadastro de motorista não envia despesa', async () => {
      await t.http().get('/api/v1/my/expenses').set(bearer(owner)).expect(403);
    });
  });
});
