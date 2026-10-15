import { execSync } from 'node:child_process';
import { join } from 'node:path';

/** Aplica as migrations e o seed (planos) no banco de testes. Cada suíte limpa os dados com resetDb(). */
export default function globalSetup(): void {
  const env = {
    ...process.env,
    DATABASE_URL:
      process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/rotagest_test?schema=public',
  };
  const cwd = join(__dirname, '..');
  execSync('npx prisma migrate deploy', { cwd, env, stdio: 'pipe' });
  execSync('npx prisma db seed', { cwd, env, stdio: 'pipe' });
}
