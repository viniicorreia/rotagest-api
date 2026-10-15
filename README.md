# rotagest-api

Backend da plataforma **RotaGest** (SaaS multiempresa de gestão financeira para transportes): NestJS, Prisma, PostgreSQL, JWT e OpenAPI.

Este repositório contém **todas** as regras de negócio, autenticação, autorização, validações, isolamento multi-tenant e persistência financeira. O frontend fica no repositório independente **rotagest-web**, que consome esta API apenas por HTTP/JSON.

- Arquitetura completa (requisitos, modelo de dados, multi-tenant, regras financeiras, autenticação e plano): [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Relatório da Fase 1: [`docs/PHASE-1.md`](docs/PHASE-1.md)
- Segurança, backups e LGPD: [`docs/SECURITY.md`](docs/SECURITY.md)

## Contrato da API

| Item | Valor |
|---|---|
| Base | `http://localhost:3000/api/v1` |
| Swagger UI | `http://localhost:3000/api/docs` |
| OpenAPI JSON | `http://localhost:3000/api/docs-json` e o arquivo versionado [`openapi.json`](openapi.json) |
| Autenticação | `Authorization: Bearer <accessToken>`; refresh em cookie `HttpOnly` `rg_refresh` (`Path=/api/v1/auth`) |
| Erros | `{ statusCode, code, message, details?, requestId? }` |

Ao mudar rotas ou DTOs, rode `npm run openapi:export` e versione o `openapi.json`. O teste `test/contract.e2e-spec.ts` falha se o arquivo estiver desatualizado. O rotagest-web gera seus tipos a partir dele.

## Estrutura

```
prisma/            schema.prisma, migrations versionadas, seed.ts
src/
  config/          validação das variáveis de ambiente
  domain/          papéis, permissões, CPF/CNPJ (regras puras)
  common/          guards (JWT, tenant, permissões), decorators, filtro de erros, DTOs comuns
  prisma/          PrismaService
  modules/         auth, companies, memberships, subscriptions, audit, mail, meta, health
scripts/           export-openapi.ts
test/              testes e2e com PostgreSQL real
docs/              documentação
```

## Executar localmente

Pré-requisitos: Node 22+ e PostgreSQL 16 (local ou `docker compose up -d db`).

```bash
npm install
cp .env.example .env              # ajuste DATABASE_URL e JWT_ACCESS_SECRET
npx prisma migrate deploy         # aplica as migrations
npm run prisma:seed               # planos Starter / Professional / Business
npm run start:dev                 # http://localhost:3000/api/v1
```

Para criar um SUPER_ADMIN no seed, preencha `SEED_SUPER_ADMIN_EMAIL` e `SEED_SUPER_ADMIN_PASSWORD`.

### Junto com o rotagest-web

1. Suba esta API (`npm run start:dev`, porta 3000) com `CORS_ORIGINS=http://localhost:5173` e `WEB_URL=http://localhost:5173`.
2. No rotagest-web: `VITE_API_URL=http://localhost:3000/api/v1` e `npm run dev` (porta 5173).

Em produção, publique web e API no mesmo site (ex.: `app.seudominio.com` e `api.seudominio.com`) com HTTPS, `COOKIE_SECURE=true` e `CORS_ORIGINS=https://app.seudominio.com`.

## Testes

```bash
createdb rotagest_test             # banco exclusivo de testes
npm test                           # unitários + e2e
```

Os testes aplicam as migrations em `rotagest_test` (ou `TEST_DATABASE_URL`) e limpam os dados entre suítes. Nunca aponte para um banco com dados reais.

## Docker

```bash
cp .env.example .env
docker compose up -d --build       # PostgreSQL + API na porta 3000
```
