import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AppConfig } from '../src/config/app-config.service';
import { addMonths, firstOfMonth, formatDate, formatMonth, today as businessToday } from '../src/domain';
import { validateEnv, type Env } from '../src/config/env';
import { MAIL_TRANSPORT, type MailMessage, type MailTransport } from '../src/modules/mail/mail.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { setupApp } from '../src/setup-app';

export class InMemoryMailTransport implements MailTransport {
  readonly sent: MailMessage[] = [];
  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }
  lastTo(email: string): MailMessage | undefined {
    return [...this.sent].reverse().find((m) => m.to === email);
  }
}

export interface TestApp {
  app: INestApplication;
  prisma: PrismaService;
  mail: InMemoryMailTransport;
  http: () => ReturnType<typeof request>;
  close: () => Promise<void>;
}

export async function createTestApp(envOverrides: Partial<Env> = {}): Promise<TestApp> {
  const mail = new InMemoryMailTransport();
  const env: Env = { ...validateEnv(process.env), ...envOverrides };
  const config = Object.assign(Object.create(AppConfig.prototype) as AppConfig, {
    get: <K extends keyof Env>(key: K): Env[K] => env[key],
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MAIL_TRANSPORT)
    .useValue(mail)
    .overrideProvider(AppConfig)
    .useValue(config)
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  setupApp(app);
  await app.init();
  return {
    app,
    prisma: app.get(PrismaService),
    mail,
    http: () => request(app.getHttpServer()),
    close: () => app.close(),
  };
}

/** Limpa os dados entre suítes, preservando os planos do seed. */
export async function resetDb(prisma: PrismaService): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT IN ('_prisma_migrations', 'plans', 'plan_features')`;
  const list = tables.map((t) => `"${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}

// ---------------------------------------------------------------------------
// Fábricas
// ---------------------------------------------------------------------------

let seq = 0;
export function uniqueEmail(prefix = 'user'): string {
  seq += 1;
  return `${prefix}.${Date.now()}.${seq}@teste.com`;
}

/** Gera um CNPJ válido (dígitos verificadores corretos) a partir de um número-base. */
export function makeCnpj(n: number): string {
  const base = String(10_000_000 + n).padStart(8, '0') + '0001';
  const digit = (s: string) => {
    const w = s.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = s.split('').reduce((acc, d, i) => acc + Number(d) * w[i], 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = digit(base);
  const d2 = digit(base + d1);
  return `${base}${d1}${d2}`;
}

export interface Session {
  email: string;
  password: string;
  token: string;
  cookie: string;
  userId: string;
}

export function refreshCookieFrom(res: request.Response): string {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = raw?.find((c) => c.startsWith('rg_refresh=') && !c.startsWith('rg_refresh=;'));
  if (!cookie) throw new Error('Cookie de refresh ausente');
  return cookie.split(';')[0];
}

export const PASSWORD = 'Senha12345';

export async function register(t: TestApp, name = 'Usuário Teste', email = uniqueEmail()): Promise<Session> {
  const res = await t.http().post('/api/v1/auth/register').send({ name, email, password: PASSWORD }).expect(201);
  const user = await t.prisma.user.findUniqueOrThrow({ where: { email } });
  return { email, password: PASSWORD, token: res.body.accessToken, cookie: refreshCookieFrom(res), userId: user.id };
}

let cnpjSeq = 1;
export async function createCompany(t: TestApp, s: Session, tradeName = 'Transportes Teste') {
  cnpjSeq += 1;
  const res = await t
    .http()
    .post('/api/v1/companies')
    .set('Authorization', `Bearer ${s.token}`)
    .send({ tradeName, personType: 'COMPANY', document: makeCnpj(cnpjSeq), city: 'Campinas', state: 'SP' })
    .expect(201);
  s.token = res.body.accessToken;
  return res.body.company as { id: string; tradeName: string };
}

/** Proprietário com empresa pronta (empresa ativa no token). */
export async function ownerWithCompany(t: TestApp, tradeName?: string) {
  const owner = await register(t, 'Dono');
  const company = await createCompany(t, owner, tradeName);
  return { owner, company };
}

export function inviteTokenFrom(inviteUrl: string): string {
  return decodeURIComponent(inviteUrl.split('/invite/')[1]);
}

/** Convida e faz o convidado aceitar; devolve a sessão do convidado já com a empresa ativa. */
export async function addMember(t: TestApp, owner: Session, role: string, permissions: string[] = []) {
  const email = uniqueEmail(role.toLowerCase());
  const inv = await t
    .http()
    .post('/api/v1/invitations')
    .set('Authorization', `Bearer ${owner.token}`)
    .send({ email, role, permissions })
    .expect(201);
  const member = await register(t, `Membro ${role}`, email);
  const acc = await t
    .http()
    .post(`/api/v1/invitations/token/${encodeURIComponent(inviteTokenFrom(inv.body.inviteUrl))}/accept`)
    .set('Authorization', `Bearer ${member.token}`)
    .expect(200);
  member.token = acc.body.accessToken;
  const row = await t.prisma.companyMember.findFirstOrThrow({
    where: { userId: member.userId, companyId: acc.body.activeCompanyId },
  });
  return { member, memberId: row.id };
}

export const bearer = (s: Session) => ({ Authorization: `Bearer ${s.token}` });

// ---------------------------------------------------------------------------
// Fase 2 — financeiro
// ---------------------------------------------------------------------------


/** Datas relativas a hoje (fuso de São Paulo), para os testes não envelhecerem. */
export const dates = {
  today: () => formatDate(businessToday()),
  daysAgo: (n: number) => formatDate(new Date(businessToday().getTime() - n * 86_400_000)),
  daysAhead: (n: number) => formatDate(new Date(businessToday().getTime() + n * 86_400_000)),
  month: (offset = 0) => formatMonth(addMonths(firstOfMonth(businessToday()), offset, 1)),
  /** Dia `day` do mês com deslocamento `offset` em relação ao atual. */
  dayOfMonth: (offset: number, day: number) => formatDate(addMonths(firstOfMonth(businessToday()), offset, day)),
};

export const key = () => randomUUID();

export async function categoryId(t: TestApp, s: Session, systemKey: string): Promise<string> {
  const res = await t.http().get('/api/v1/categories').set(bearer(s)).expect(200);
  const found = (res.body as { id: string; systemKey: string | null }[]).find((c) => c.systemKey === systemKey);
  if (!found) throw new Error(`Categoria ${systemKey} não encontrada`);
  return found.id;
}

export async function createAccount(t: TestApp, s: Session, name = 'Conta Corrente', openingBalance = '0.00', openingBalanceDate = dates.daysAgo(30)) {
  const res = await t
    .http()
    .post('/api/v1/accounts')
    .set(bearer(s))
    .send({ name, type: 'CHECKING', openingBalance, openingBalanceDate })
    .expect(201);
  return res.body as { id: string; balance: string };
}

let plateSeq = 100;
export function nextPlate(): string {
  plateSeq += 1;
  return `RGT${String(plateSeq).padStart(4, '0')}`;
}

export async function createVehicle(t: TestApp, s: Session, name = 'Van') {
  const res = await t.http().post('/api/v1/vehicles').set(bearer(s)).send({ name, plate: nextPlate() }).expect(201);
  return res.body as { id: string; name: string; plate: string };
}

export async function balanceOf(t: TestApp, s: Session, accountId: string): Promise<string> {
  const res = await t.http().get(`/api/v1/accounts/${accountId}`).set(bearer(s)).expect(200);
  return res.body.balance;
}
