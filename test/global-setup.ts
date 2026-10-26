import { execSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * Aplica as migrations, libera o login do papel da aplicação e roda o seed
 * (planos) no banco de testes. Cada suíte limpa os dados com resetDb().
 */
export default function globalSetup(): void {
  const direct =
    process.env.TEST_DIRECT_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/rotagest_test?schema=public';
  const env = {
    ...process.env,
    DATABASE_URL: direct,
    DIRECT_DATABASE_URL: direct,
    APP_DB_PASSWORD: process.env.APP_DB_PASSWORD ?? 'rotagest_app',
  };
  const cwd = join(__dirname, '..');
  execSync('npx prisma migrate deploy', { cwd, env, stdio: 'pipe' });
  execSync('node scripts/db-app-role.js', { cwd, env, stdio: 'pipe' });
  execSync('npx prisma db seed', { cwd, env, stdio: 'pipe' });
}
