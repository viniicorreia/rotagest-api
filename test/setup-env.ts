import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Ambiente dos testes: banco isolado e limites de taxa altos (o teste de
// rate limit cria sua própria app com limite baixo).
process.env.NODE_ENV = 'test';
// A API conecta como o papel da aplicação (sujeito ao RLS); limpeza e
// migrations usam o dono do banco.
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://rotagest_app:rotagest_app@localhost:5432/rotagest_test?schema=public';
process.env.DIRECT_DATABASE_URL =
  process.env.TEST_DIRECT_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/rotagest_test?schema=public';
process.env.JWT_ACCESS_SECRET = 'test-secret-with-at-least-32-characters!!';
process.env.LOG_LEVEL = 'silent';
process.env.WEB_URL = 'http://localhost:5173';
process.env.RATE_LIMIT_DEFAULT = '100000';
process.env.RATE_LIMIT_AUTH = '100000';
process.env.DEFAULT_PLAN_CODE = 'starter';
process.env.TRIAL_DAYS = '14';
process.env.CORS_ORIGINS = "http://localhost:5173";
process.env.STORAGE_DIR = join(tmpdir(), 'rotagest-test-storage');
process.env.JOBS_ENABLED = 'false';
