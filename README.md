# rotagest-api

Backend da plataforma **RotaGest** (SaaS multiempresa de gestão financeira para transportes): NestJS, Prisma, PostgreSQL, JWT e OpenAPI.

Este repositório contém **todas** as regras de negócio, autenticação, autorização, validações, isolamento multi-tenant e persistência financeira. O frontend fica no repositório independente **rotagest-web**, que consome esta API apenas por HTTP/JSON.

- Arquitetura completa (requisitos, modelo de dados, multi-tenant, regras financeiras, autenticação e plano): [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Relatório da Fase 1: [`docs/PHASE-1.md`](docs/PHASE-1.md)
- Relatório da Fase 2: [`docs/PHASE-2.md`](docs/PHASE-2.md)
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
  modules/         auth, companies, memberships, subscriptions, audit, mail, meta, health, metrics
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

## Operação

Variáveis completas e comentadas em [`.env.example`](.env.example).

**Saúde** (públicas, sem rate limit):

| Rota | Uso |
|---|---|
| `GET /api/v1/health/live` | Liveness: só confirma que o processo responde (não consulta o banco). Use para reiniciar o contêiner. |
| `GET /api/v1/health/ready` | Readiness: executa `SELECT 1` com limite de 2 s; responde `503` (`DB_UNAVAILABLE`) se o banco estiver fora. Use no balanceador. |
| `GET /api/v1/health` | Mantida por compatibilidade (mesmo comportamento da readiness). |

**E-mail (SMTP).** Defina `SMTP_URL` (ex.: `smtps://usuario:senha@smtp.seuprovedor.com:465`) e `MAIL_FROM`. Sem `SMTP_URL`, convites e redefinições de senha só vão para o log; em produção a API sobe com um aviso e nenhum e-mail sai. O corpo das mensagens (que contém links com token) nunca é registrado em produção. Falhas de envio são registradas no log e não interrompem a requisição.

**Comprovantes em S3.** `STORAGE_DRIVER=s3` com `S3_BUCKET` e `S3_REGION` (obrigatórios) e credenciais pela cadeia padrão da AWS (`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`, perfil ou role). Para MinIO/R2, informe `S3_ENDPOINT` e, se preciso, `S3_FORCE_PATH_STYLE=true`. O bucket deve bloquear acesso público: a API não envia ACL nem gera URLs pré-assinadas, e o download continua passando por ela (tenant + permissão). As chaves são as mesmas do disco (`<companyId>/<id>.<ext>`); ao migrar, copie o conteúdo de `STORAGE_DIR` para a raiz do bucket.

**Métricas (Prometheus).** Defina `METRICS_TOKEN` (mín. 16 caracteres) e configure o scrape em `/api/v1/metrics` com `Authorization: Bearer <token>`. Sem token o endpoint responde `404`. Expõe as métricas padrão do processo Node e `http_request_duration_seconds` (rótulos `method`, `route` — o modelo da rota, ex.: `/api/v1/payables/:id` — e `status_code`). Fica fora do OpenAPI.

```yaml
# prometheus.yml
scrape_configs:
  - job_name: rotagest-api
    metrics_path: /api/v1/metrics
    authorization: { credentials: <METRICS_TOKEN> }
    static_configs: [{ targets: ['api:3000'] }]
```

**Logs.** JSON (pino) em produção. Cada linha emitida durante uma requisição traz `requestId` (o mesmo do header `x-request-id`, aceito do proxy ou gerado, e do campo `requestId` das respostas de erro). Os headers `Authorization`, `Cookie` e `Set-Cookie` são mascarados. Sondas de saúde e scrapes de métricas não geram log de acesso.

## Docker

```bash
cp .env.example .env
docker compose up -d --build       # PostgreSQL + API na porta 3000
```
