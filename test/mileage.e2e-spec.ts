import { addMember, bearer, createTestApp, createVehicle, dates, ownerWithCompany, resetDb, type Session, type TestApp } from './helpers';

const CPF = ['52998224725', '11144477735'];

describe('Motoristas, rotas, escala e registro diário de km (e2e)', () => {
  let t: TestApp;
  let owner: Session;
  let driverUser: Session;
  let v1: { id: string };
  let v2: { id: string };
  let routeId: string;
  const created: { date: string; amount: string | null; vehicleId: string }[] = [];

  beforeAll(async () => {
    t = await createTestApp();
    await resetDb(t.prisma);
    ({ owner } = await ownerWithCompany(t, 'Vans do Teste'));
    v1 = await createVehicle(t, owner, 'Van 01');
    v2 = await createVehicle(t, owner, 'Van 02');
  });
  afterAll(() => t.close());

  const log = (s: Session, body: Record<string, unknown>) => t.http().post('/api/v1/daily-logs').set(bearer(s)).send(body);

  it('define o valor por km do veículo e calcula km × taxa no registro do dia', async () => {
    const upd = await t.http().patch(`/api/v1/vehicles/${v1.id}`).set(bearer(owner)).send({ ratePerKm: '3.5' }).expect(200);
    expect(upd.body.ratePerKm).toBe('3.50');

    const res = await log(owner, { vehicleId: v1.id, date: dates.today(), kmDriven: '120' }).expect(201);
    expect(res.body).toMatchObject({ kmDriven: '120.0', ratePerKm: '3.50', amount: '420.00', billed: false, editable: true });
    created.push({ date: dates.today(), amount: '420.00', vehicleId: v1.id });

    // Um registro por veículo por dia.
    await log(owner, { vehicleId: v1.id, date: dates.today(), kmDriven: '10' }).expect(409);
    // Dia futuro não existe ainda.
    await log(owner, { vehicleId: v1.id, date: dates.daysAhead(1), kmDriven: '10' }).expect(400);
  });

  it('aceita hodômetros de saída e chegada e atualiza o hodômetro do veículo', async () => {
    const res = await log(owner, { vehicleId: v1.id, date: dates.daysAgo(1), odometerStart: 1000, odometerEnd: 1080 }).expect(201);
    expect(res.body).toMatchObject({ kmDriven: '80.0', amount: '280.00', odometerStart: 1000, odometerEnd: 1080 });
    created.push({ date: dates.daysAgo(1), amount: '280.00', vehicleId: v1.id });
    const v = await t.http().get(`/api/v1/vehicles/${v1.id}`).set(bearer(owner)).expect(200);
    expect(v.body.odometerKm).toBe(1080);

    await log(owner, { vehicleId: v1.id, date: dates.daysAgo(3), kmDriven: '50', odometerStart: 2000, odometerEnd: 2080 }).expect(400);
    await log(owner, { vehicleId: v1.id, date: dates.daysAgo(3), odometerStart: 2000 }).expect(400);
    await log(owner, { vehicleId: v1.id, date: dates.daysAgo(3) }).expect(400);
    await log(owner, { vehicleId: v1.id, date: dates.daysAgo(3), kmDriven: '6000' }).expect(400);
  });

  it('veículo sem taxa registra o km sem valor; ao definir a taxa, os dias a faturar são recalculados', async () => {
    const res = await log(owner, { vehicleId: v2.id, date: dates.today(), kmDriven: '100' }).expect(201);
    expect(res.body.amount).toBeNull();
    const before = await t.http().get(`/api/v1/daily-logs?vehicleId=${v2.id}`).set(bearer(owner)).expect(200);
    expect(before.body.summary).toMatchObject({ days: 1, missingRateDays: 1 });

    await t.http().patch(`/api/v1/vehicles/${v2.id}`).set(bearer(owner)).send({ ratePerKm: '2.875' }).expect(200);
    const after = await t.http().get(`/api/v1/daily-logs?vehicleId=${v2.id}`).set(bearer(owner)).expect(200);
    expect(after.body.items[0]).toMatchObject({ ratePerKm: '2.875', amount: '287.50' });
    expect(after.body.summary).toMatchObject({ missingRateDays: 0, amount: '287.50', unbilledAmount: '287.50' });
    created.push({ date: dates.today(), amount: '287.50', vehicleId: v2.id });
  });

  describe('portal do motorista', () => {
    beforeAll(async () => {
      const { member, memberId } = await addMember(t, owner, 'DRIVER');
      driverUser = member;
      const driver = await t.http().post('/api/v1/drivers').set(bearer(owner)).send({ name: 'José Motorista', document: '529.982.247-25', memberId }).expect(201);
      expect(driver.body).toMatchObject({ document: CPF[0], member: { id: memberId } });
      await t.http().post('/api/v1/drivers').set(bearer(owner)).send({ name: 'Outro', document: CPF[0] }).expect(409);
      await t.http().post('/api/v1/drivers').set(bearer(owner)).send({ name: 'CPF ruim', document: '12345678900' }).expect(400);

      const route = await t.http().post('/api/v1/routes').set(bearer(owner)).send({ name: 'Escola Centro — manhã', transportType: 'SCHOOL' }).expect(201);
      routeId = route.body.id;
      await t
        .http()
        .post('/api/v1/assignments')
        .set(bearer(owner))
        .send({ routeId, vehicleId: v1.id, driverId: driver.body.id, startDate: dates.daysAgo(20) })
        .expect(201);
      // Mesmo veículo na mesma rota, período sobreposto.
      await t.http().post('/api/v1/assignments').set(bearer(owner)).send({ routeId, vehicleId: v1.id, startDate: dates.daysAgo(5) }).expect(409);
    });

    it('mostra ao motorista a rota e o veículo de hoje', async () => {
      const res = await t.http().get('/api/v1/assignments/mine').set(bearer(driverUser)).expect(200);
      expect(res.body.driver.name).toBe('José Motorista');
      expect(res.body.vehicles.map((v: { id: string }) => v.id)).toEqual([v1.id]);
      expect(res.body.assignments[0].route.id).toBe(routeId);
      await t.http().get('/api/v1/drivers').set(bearer(driverUser)).expect(403);
    });

    it('motorista registra km só no veículo escalado, dentro do prazo, e não vê valores', async () => {
      const res = await log(driverUser, { vehicleId: v1.id, date: dates.daysAgo(2), kmDriven: '95.5' }).expect(201);
      expect(res.body).toMatchObject({ kmDriven: '95.5', amount: null, ratePerKm: null, route: { id: routeId }, driver: { name: 'José Motorista' } });
      created.push({ date: dates.daysAgo(2), amount: '334.25', vehicleId: v1.id });

      await log(driverUser, { vehicleId: v2.id, date: dates.daysAgo(2), kmDriven: '10' }).expect(403);
      await log(driverUser, { vehicleId: v1.id, date: dates.daysAgo(10), kmDriven: '10' }).expect(403);

      const list = await t.http().get(`/api/v1/daily-logs?from=${dates.daysAgo(30)}`).set(bearer(driverUser)).expect(200);
      expect(list.body.items).toHaveLength(1);
      expect(list.body.summary.amount).toBeNull();

      await t.http().patch(`/api/v1/daily-logs/${res.body.id}`).set(bearer(driverUser)).send({ kmDriven: '96' }).expect(200);
      created[created.length - 1].amount = '336.00';
      await t.http().get(`/api/v1/daily-logs/billing?month=${dates.month()}`).set(bearer(driverUser)).expect(403);
    });

    it('motorista não altera registro de outra pessoa', async () => {
      const others = await t.http().get(`/api/v1/daily-logs?vehicleId=${v1.id}&from=${dates.daysAgo(5)}`).set(bearer(owner)).expect(200);
      const ownerLog = others.body.items.find((i: { driver: unknown }) => i.driver === null);
      await t.http().patch(`/api/v1/daily-logs/${ownerLog.id}`).set(bearer(driverUser)).send({ kmDriven: '1' }).expect(404);
    });
  });

  describe('faturamento por km', () => {
    it('mostra a prévia e gera uma conta a receber por veículo com os km do mês', async () => {
      const month = dates.month();
      const inMonth = created.filter((c) => c.vehicleId === v1.id && c.date.startsWith(month));
      const expected = inMonth.reduce((acc, c) => acc + Math.round(Number(c.amount) * 100), 0);

      const preview = await t.http().get(`/api/v1/daily-logs/billing?month=${month}`).set(bearer(owner)).expect(200);
      const row = preview.body.vehicles.find((v: { vehicle: { id: string } }) => v.vehicle.id === v1.id);
      expect(row).toMatchObject({ days: inMonth.length, ratePerKm: '3.50', amount: (expected / 100).toFixed(2) });

      const bill = await t
        .http()
        .post('/api/v1/daily-logs/billing')
        .set(bearer(owner))
        .send({ month, dueDate: dates.dayOfMonth(1, 5), vehicleIds: [v1.id] })
        .expect(201);
      const item = bill.body.items[0];
      expect(item).toMatchObject({ days: inMonth.length, amount: (expected / 100).toFixed(2) });

      const rec = await t.http().get(`/api/v1/receivables/${item.receivableId}`).set(bearer(owner)).expect(200);
      expect(rec.body).toMatchObject({ amount: (expected / 100).toFixed(2), competence: month, category: { systemKey: 'CONTRACT' } });
      expect(rec.body.allocations).toEqual([expect.objectContaining({ vehicle: expect.objectContaining({ id: v1.id }), amount: (expected / 100).toFixed(2) })]);

      // Faturado: não fatura de novo nem deixa editar o dia.
      await t.http().post('/api/v1/daily-logs/billing').set(bearer(owner)).send({ month, dueDate: dates.dayOfMonth(1, 5), vehicleIds: [v1.id] }).expect(422);
      const logs = await t.http().get(`/api/v1/daily-logs?vehicleId=${v1.id}&from=${month}-01&billed=true`).set(bearer(owner)).expect(200);
      expect(logs.body.items).toHaveLength(inMonth.length);
      await t.http().patch(`/api/v1/daily-logs/${logs.body.items[0].id}`).set(bearer(owner)).send({ kmDriven: '1' }).expect(422);
      await t.http().delete(`/api/v1/daily-logs/${logs.body.items[0].id}`).set(bearer(owner)).expect(422);

      // A receita aparece no resultado do veículo.
      const vehicle = await t.http().get(`/api/v1/vehicles/${v1.id}?from=${month}&to=${month}`).set(bearer(owner)).expect(200);
      expect(vehicle.body.financial.revenue).toBe((expected / 100).toFixed(2));

      // Cancelar a conta libera os dias para faturar de novo.
      await t.http().post(`/api/v1/receivables/${item.receivableId}/cancel`).set(bearer(owner)).send({ reason: 'Faturado com vencimento errado' }).expect(200);
      const again = await t.http().get(`/api/v1/daily-logs?vehicleId=${v1.id}&from=${month}-01&billed=false`).set(bearer(owner)).expect(200);
      expect(again.body.items).toHaveLength(inMonth.length);
    });

    it('não fatura veículo de outra empresa nem expõe registros entre empresas', async () => {
      const other = await ownerWithCompany(t, 'Outra Empresa');
      await t.http().post('/api/v1/daily-logs/billing').set(bearer(other.owner)).send({ month: dates.month(), dueDate: dates.dayOfMonth(1, 5), vehicleIds: [v1.id] }).expect(404);
      await log(other.owner, { vehicleId: v1.id, date: dates.today(), kmDriven: '10' }).expect(404);
      const list = await t.http().get('/api/v1/daily-logs').set(bearer(other.owner)).expect(200);
      expect(list.body.items).toHaveLength(0);
      const someLog = await t.prisma.vehicleDailyLog.findFirstOrThrow({ where: { vehicleId: v1.id } });
      await t.http().patch(`/api/v1/daily-logs/${someLog.id}`).set(bearer(other.owner)).send({ kmDriven: '1' }).expect(404);
    });

    it('mês fechado bloqueia novos registros', async () => {
      const company = await t.prisma.vehicle.findUniqueOrThrow({ where: { id: v2.id }, select: { companyId: true } });
      const d = new Date(`${dates.daysAgo(40)}T00:00:00Z`);
      await t.prisma.monthlyClosing.create({
        data: { companyId: company.companyId, year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, snapshot: {}, closedById: owner.userId },
      });
      const res = await log(owner, { vehicleId: v2.id, date: dates.daysAgo(40), kmDriven: '10' }).expect(409);
      expect(res.body.code).toBe('PERIOD_CLOSED');
    });
  });
});
