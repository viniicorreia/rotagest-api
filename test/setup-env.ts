// Ambiente dos testes: banco isolado e limites de taxa altos (o teste de
// rate limit cria sua própria app com limite baixo).
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/rotagest_test?schema=public';
process.env.JWT_ACCESS_SECRET = 'test-secret-with-at-least-32-characters!!';
process.env.LOG_LEVEL = 'silent';
process.env.WEB_URL = 'http://localhost:5173';
process.env.RATE_LIMIT_DEFAULT = '100000';
process.env.RATE_LIMIT_AUTH = '100000';
process.env.DEFAULT_PLAN_CODE = 'starter';
process.env.TRIAL_DAYS = '14';
process.env.CORS_ORIGINS = "http://localhost:5173";
