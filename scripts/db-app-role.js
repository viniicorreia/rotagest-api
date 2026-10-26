/**
 * Libera o login do papel da aplicação (rotagest_app), criado sem senha pela
 * migration de RLS. Roda como dono do banco e é idempotente:
 *
 *   DIRECT_DATABASE_URL=postgresql://dono:...@host/rotagest APP_DB_PASSWORD=... npm run db:app-role
 *
 * Depois disso a API usa DATABASE_URL=postgresql://rotagest_app:<APP_DB_PASSWORD>@host/rotagest.
 * Em JavaScript puro para rodar também na imagem de produção (sem ts-node).
 */
const { PrismaClient } = require('@prisma/client');

async function main() {
  const url = process.env.DIRECT_DATABASE_URL;
  const password = process.env.APP_DB_PASSWORD;
  if (!url) throw new Error('Defina DIRECT_DATABASE_URL (conexão do dono do banco).');
  if (!password || (process.env.NODE_ENV === 'production' && password.length < 12)) {
    throw new Error('Defina APP_DB_PASSWORD (mínimo de 12 caracteres em produção).');
  }
  const prisma = new PrismaClient({ datasourceUrl: url });
  try {
    const [role] = await prisma.$queryRaw`SELECT 1 FROM pg_roles WHERE rolname = 'rotagest_app'`;
    if (!role) throw new Error('O papel rotagest_app não existe. Rode as migrations antes (prisma migrate deploy).');
    // ALTER ROLE não aceita parâmetro; o literal é escapado pelo próprio PostgreSQL com format(%L).
    const [{ sql }] = await prisma.$queryRaw`SELECT format('ALTER ROLE rotagest_app WITH LOGIN PASSWORD %L', ${password}::text) AS sql`;
    await prisma.$executeRawUnsafe(sql);
    console.log('rotagest_app: login liberado.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
