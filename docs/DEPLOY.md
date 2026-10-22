# Deploy do RotaGest

O RotaGest é publicado como duas imagens Docker independentes, geradas pelo
GitHub Actions e guardadas no GitHub Container Registry (GHCR):

| Imagem | Origem | Porta | Conteúdo |
| --- | --- | --- | --- |
| `ghcr.io/viniicorreia/rotagest-api` | repositório `rotagest-api` | 3000 | API NestJS + Prisma (migrations em `prisma/`) |
| `ghcr.io/viniicorreia/rotagest-web` | repositório `rotagest` (web) | 8080 | SPA estática servida por Nginx, sem root |

Não há deploy automático: o pipeline entrega a imagem e a implantação no
servidor (VM com Docker Compose, Kubernetes, Fly, Render, etc.) é feita à parte.

## 1. Pipelines (GitHub Actions)

**CI** (`.github/workflows/ci.yml`, em todo push e pull request):

- API: `npm ci` → `prisma generate` → `typecheck` → `npm test` (unitários e e2e
  contra um PostgreSQL 16 de serviço, com RLS e o papel `rotagest_app`) →
  `build` → confere se o `openapi.json` versionado está atualizado.
- Web: `npm ci` → `typecheck` → `npm test` → `build`.

**Docker** (`.github/workflows/docker.yml`, em push na `main` e em tags `v*`):

| Evento | Tags geradas |
| --- | --- |
| push na `main` | `main`, `sha-<commit>` |
| tag `v1.4.0` | `1.4.0`, `1.4`, `latest`, `sha-<commit>` |

Para publicar uma versão: `git tag v1.4.0 && git push origin v1.4.0` (em cada
repositório). Em produção, use sempre uma tag fixa (`1.4.0` ou `sha-...`),
nunca `latest` ou `main`, para que o rollback seja só trocar a tag.

O pacote no GHCR nasce privado. Para o servidor baixar a imagem, torne o pacote
público (Package settings) ou faça `docker login ghcr.io` com um token
(*personal access token* com `read:packages`).

### Variável do build do web

A URL da API é embutida no bundle do web no momento do build (Vite) e define a
origem liberada no `Content-Security-Policy` (`connect-src`). No repositório do
web, crie a variável do Actions:

```
Settings > Secrets and variables > Actions > Variables
VITE_API_URL = https://api.seudominio.com.br/api/v1
```

Sem ela, a imagem sai com `http://localhost:3000/api/v1` (só serve para teste
local). Trocou o domínio da API? Gere uma nova imagem do web. Se a API for
servida no mesmo domínio do web (ex.: proxy em `/api`), use
`VITE_API_URL=/api/v1`; o CSP fica só com `'self'`.

Build manual: `docker build --build-arg VITE_API_URL=https://api.seudominio.com.br/api/v1 -t rotagest-web .`

## 2. Banco de dados e papéis

A API usa dois acessos ao PostgreSQL 16:

| Variável | Papel | Usada por |
| --- | --- | --- |
| `DIRECT_DATABASE_URL` | dono do banco (ex.: `rotagest`) | migrations (`directUrl` do Prisma), seed e `db:app-role` |
| `DATABASE_URL` | `rotagest_app` (não é dono, sem `BYPASSRLS`) | a API em execução, sujeita ao Row-Level Security |

A migration de RLS cria o papel `rotagest_app` **sem login** (`NOLOGIN`). O
script `db:app-role` libera o login com a senha de `APP_DB_PASSWORD` (mínimo de
12 caracteres em produção). Ele é idempotente: rodar de novo apenas troca a
senha (útil para rotação).

Nunca aponte `DATABASE_URL` para o dono do banco em produção: o dono ignora as
políticas de RLS e o isolamento entre empresas deixa de valer no banco.

## 3. Variáveis de ambiente da API

Obrigatórias em produção:

| Variável | Exemplo / observação |
| --- | --- |
| `NODE_ENV` | `production` (já definido na imagem) |
| `DATABASE_URL` | `postgresql://rotagest_app:<APP_DB_PASSWORD>@db:5432/rotagest?schema=public` |
| `DIRECT_DATABASE_URL` | `postgresql://rotagest:<senha-do-dono>@db:5432/rotagest?schema=public` (só no job de migração; ver §4) |
| `JWT_ACCESS_SECRET` | 32+ caracteres: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `COOKIE_SECURE` | `true` (a API recusa subir em produção sem isso) |
| `CORS_ORIGINS` | `https://app.seudominio.com.br` (origens do web, separadas por vírgula) |
| `WEB_URL` | `https://app.seudominio.com.br` (links de convite e de redefinição de senha) |
| `TRUST_PROXY` | `true` atrás de proxy reverso (IP real para rate limit e logs) |

Recomendadas / opcionais:

| Variável | Observação |
| --- | --- |
| `APP_DB_PASSWORD` | só para o `db:app-role` (§4) |
| `SMTP_URL`, `MAIL_FROM` | sem `SMTP_URL` os e-mails só vão para o log |
| `STORAGE_DRIVER` | `local` (padrão, usa `STORAGE_DIR`) ou `s3` |
| `STORAGE_DIR` | com `local`, monte um volume persistente gravável pelo usuário `node` (ex.: `/app/storage`) |
| `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE` | com `s3` (AWS, R2, MinIO...); credenciais pelas variáveis padrão da AWS |
| `METRICS_TOKEN` | habilita `/metrics` (Prometheus) com Bearer; vazio = desativado |
| `SWAGGER_ENABLED` | `false` em produção, salvo necessidade |
| `LOG_LEVEL`, `RATE_LIMIT_DEFAULT`, `RATE_LIMIT_AUTH`, `ATTACHMENT_MAX_MB` | ver `.env.example` |
| `SEED_SUPER_ADMIN_EMAIL`, `SEED_SUPER_ADMIN_PASSWORD` | só no seed do primeiro deploy |

A lista completa e validada fica em `src/config/env.ts`; variáveis inválidas
impedem a API de subir, com a mensagem `Configuração inválida: ...` no log.

## 4. Primeiro deploy (ordem)

1. **PostgreSQL 16** no ar, com um banco `rotagest` e um usuário dono
   (`rotagest`). Backup automático configurado antes de receber dados reais.
2. **Migrations e login do papel da aplicação**, como dono. Cria tabelas,
   políticas de RLS e o papel `rotagest_app`, e define a senha dele
   (idempotente; rode a cada deploy):

   ```sh
   docker run --rm \
     -e DATABASE_URL="$DIRECT_DATABASE_URL" -e DIRECT_DATABASE_URL="$DIRECT_DATABASE_URL" \
     -e APP_DB_PASSWORD="$APP_DB_PASSWORD" \
     ghcr.io/viniicorreia/rotagest-api:1.0.0 \
     npm run db:deploy
   ```

3. (passo incorporado ao anterior) Sem acesso à imagem, o equivalente em SQL
   (como dono) é `ALTER ROLE rotagest_app WITH LOGIN PASSWORD '...';`.

4. **Seed** (planos e, se definido, o super admin), como dono, a partir de um
   checkout do repositório (o seed usa `ts-node`, que não está na imagem):

   ```sh
   DATABASE_URL="$DIRECT_DATABASE_URL" DIRECT_DATABASE_URL="$DIRECT_DATABASE_URL" \
   SEED_SUPER_ADMIN_EMAIL=... SEED_SUPER_ADMIN_PASSWORD=... npm run prisma:seed
   ```

5. **API**: suba o contêiner com as variáveis do §3 e `DATABASE_URL` apontando
   para `rotagest_app`. Espere `GET /api/v1/health/ready` responder 200.
6. **Web**: suba `rotagest-web` (porta 8080) com a imagem gerada para a
   `VITE_API_URL` correta.
7. **Proxy reverso / TLS** na frente dos dois (§6) e teste: login, troca de
   empresa, upload e download de comprovante, convite (link usa `WEB_URL`).

Nos deploys seguintes a ordem é: migrations (passo 2) → nova imagem da API →
nova imagem do web. As migrations são aditivas, então a versão antiga da API
continua funcionando enquanto a nova sobe.

> **Credenciais do dono fora da API.** O ideal é rodar as migrations como job
> separado (passo 2, em CI/CD ou manualmente) e deixar o contêiner da API só com
> `DATABASE_URL` do `rotagest_app`. Por isso o `CMD` da imagem só sobe a API
> (`node dist/main.js`) e não aplica migrations.

## 5. Health checks

| Rota | Uso | Responde |
| --- | --- | --- |
| `GET /api/v1/health/live` | *liveness*: o processo está de pé | 200 sem tocar no banco |
| `GET /api/v1/health/ready` | *readiness*: pode receber tráfego | 200 com banco acessível; 503 caso contrário |
| `GET /healthz` (web) | contêiner Nginx | 200 `ok` |

Use `ready` no balanceador/orquestrador para colocar a instância em rotação e
`live` para reiniciar um processo travado (não use `ready` como liveness: uma
queda do banco reiniciaria todas as instâncias sem necessidade).

Exemplo de Docker Compose:

```yaml
services:
  api:
    image: ghcr.io/viniicorreia/rotagest-api:1.0.0
    command: ["node", "dist/main.js"]   # migrations rodam no job separado
    env_file: api.env
    volumes: [storage:/app/storage]
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/api/v1/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 15s
      timeout: 5s
      retries: 3
  web:
    image: ghcr.io/viniicorreia/rotagest-web:1.0.0
volumes:
  storage:
```

## 6. Proxy reverso e TLS

- Termine o TLS no proxy (Caddy, Traefik, Nginx, load balancer da nuvem) e
  encaminhe para `api:3000` e `web:8080` em HTTP interno.
- Publique web e API **no mesmo site** (mesmo domínio registrável), ex.:
  `app.seudominio.com.br` e `api.seudominio.com.br`. O refresh token vai num
  cookie `HttpOnly; Secure; SameSite=Strict` (`Path=/api/v1/auth`), que o
  navegador não envia entre sites diferentes.
- `COOKIE_SECURE=true` é obrigatório em produção (sem HTTPS o cookie não volta e
  o usuário perde a sessão a cada 15 minutos).
- `CORS_ORIGINS` deve listar exatamente a origem do web
  (`https://app.seudominio.com.br`, sem barra no fim). `WEB_URL` é essa mesma URL.
- `TRUST_PROXY=true` para a API usar o `X-Forwarded-For` do proxy (um salto).
  O proxy deve sobrescrever, e não só repassar, esse cabeçalho.
- Ative HSTS no proxy (`Strict-Transport-Security: max-age=31536000; includeSubDomains`);
  a API já envia os cabeçalhos do Helmet e o Nginx do web envia CSP,
  `X-Frame-Options`, `X-Content-Type-Options` e `Referrer-Policy`.
- Limite de corpo no proxy ≥ `ATTACHMENT_MAX_MB` (padrão 10 MB) mais uma folga,
  para o upload de comprovantes.
- Não exponha `/metrics` publicamente; se precisar, restrinja por rede além do
  `METRICS_TOKEN`.

Exemplo com Caddy (certificados automáticos):

```
app.seudominio.com.br {
  reverse_proxy web:8080
}
api.seudominio.com.br {
  request_body max_size 12MB
  reverse_proxy api:3000
}
```

## 7. Rollback

1. Volte a tag da imagem para a anterior (ex.: `1.4.0` → `1.3.2`) e recrie o
   contêiner. Faça o mesmo com o web se ele mudou junto.
2. **Não desfaça migrations.** Elas são aditivas (novas tabelas, colunas
   opcionais, índices, políticas), então a versão anterior da API funciona com o
   schema novo. O Prisma não tem *down migrations* e o `migrate deploy` da
   versão antiga não tenta reverter nada.
3. Se uma migration em si falhou no meio, ela fica marcada como falha em
   `_prisma_migrations`: corrija a causa e use
   `npx prisma migrate resolve --rolled-back <nome>` (ou `--applied`) antes de
   tentar de novo. Em caso de dano a dados, restaure o backup feito antes do
   deploy.
4. Qualquer migration futura que **remova** ou renomeie colunas deve ser feita
   em duas versões (primeiro a API para de usar, depois a coluna sai), para que
   o rollback de uma versão continue seguro.
