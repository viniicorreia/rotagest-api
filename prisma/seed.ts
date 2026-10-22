/**
 * Seed idempotente: planos padrão e, opcionalmente, um SUPER_ADMIN.
 * Os limites ficam no banco e podem ser alterados sem deploy.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

// Roda como dono do banco quando disponível (mesma conexão das migrations).
const prisma = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL });

const PLANS = [
  {
    code: 'starter',
    name: 'Starter',
    description: 'Para quem está começando: até 2 veículos e 2 usuários.',
    price: new Prisma.Decimal('49.90'),
    maxVehicles: 2,
    maxUsers: 2,
    sortOrder: 1,
    features: ['reports.basic'],
  },
  {
    code: 'professional',
    name: 'Professional',
    description: 'Para frotas em crescimento: até 10 veículos e 10 usuários.',
    price: new Prisma.Decimal('149.90'),
    maxVehicles: 10,
    maxUsers: 10,
    sortOrder: 2,
    features: ['reports.basic', 'reports.export', 'allocations'],
  },
  {
    code: 'business',
    name: 'Business',
    description: 'Limites negociados por contrato.',
    price: new Prisma.Decimal('0.00'),
    maxVehicles: null,
    maxUsers: null,
    sortOrder: 3,
    isPublic: false,
    features: ['reports.basic', 'reports.export', 'allocations', 'support.priority'],
  },
] as const;

async function main(): Promise<void> {
  for (const { features, ...plan } of PLANS) {
    const saved = await prisma.plan.upsert({
      where: { code: plan.code },
      // Não sobrescreve preço/limites editados depois do primeiro seed.
      update: {},
      create: { ...plan, interval: 'MONTHLY' },
    });
    for (const key of features) {
      await prisma.planFeature.upsert({
        where: { planId_key: { planId: saved.id, key } },
        update: {},
        create: { planId: saved.id, key, enabled: true },
      });
    }
  }

  const email = process.env.SEED_SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_SUPER_ADMIN_PASSWORD;
  if (email && password) {
    await prisma.user.upsert({
      where: { email },
      update: { platformRole: 'SUPER_ADMIN' },
      create: {
        email,
        name: 'Administrador da plataforma',
        platformRole: 'SUPER_ADMIN',
        passwordHash: await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 }),
      },
    });
    console.log(`SUPER_ADMIN garantido: ${email}`);
  }
  console.log('Seed concluído.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
