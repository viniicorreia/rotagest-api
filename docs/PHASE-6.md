# Fase 6 — Produção

Status: **concluída no código**. O que falta depende de infraestrutura e de
decisões do negócio (ver Pendências).

## Funcionalidades implementadas

| Área | O que funciona |
|---|---|
| Row-Level Security (§23) | A API conecta como `rotagest_app`, que não é dono das tabelas e não tem `BYPASSRLS`. Todas as tabelas com `companyId` (e `companies`) têm política `tenant_isolation`. O `PrismaService` grava a empresa ativa em cada transação (`set_config(..., true)`). Sem contexto, nenhuma linha é lida ou gravada. Uma consulta sem filtro só enxerga a empresa do token. `audit_logs` aceita só inserção. Toda a suíte e2e roda com esse papel. Desenho em ARCHITECTURE.md §5.7. |
| Acesso do suporte com consentimento (§5) | O dono autoriza em Configurações (motivo, 2 h, 24 h ou 72 h) e pode revogar. Com a autorização, o administrador da plataforma entra pelo detalhe da empresa em modo suporte: faixa amarela fixa, somente leitura (a API recusa qualquer gravação com 403 `SUPPORT_READ_ONLY`). Cada página aberta fica registrada e o dono vê a lista. Revogada ou vencida, a autorização para de valer na requisição seguinte. A plataforma recebe um e-mail quando uma empresa autoriza. |
| LGPD | "Minha conta e privacidade": baixar meus dados (JSON com cadastro, vínculos, sessões, convites e atividade) e excluir a conta. A exclusão anonimiza nome e e-mail, invalida a senha e encerra sessões e vínculos. Dono de empresa ativa é bloqueado com explicação. A transportadora pode remover os dados pessoais de um motorista inativo e manter o histórico. Política de privacidade pública em `/privacidade` e documento técnico em docs/PRIVACY.md. |
| E-mail real | SMTP via `SMTP_URL` (nodemailer). Sem ela, o e-mail vai para o log e a API avisa na subida em produção. Corpo e links com token nunca vão para o log. |
| Anexos em S3 | `STORAGE_DRIVER=s3` (AWS, MinIO, R2 etc. via `S3_ENDPOINT`). Objetos privados, download sempre pela API, que confere empresa e permissão. Disco local continua o padrão. |
| Observabilidade | `GET /api/v1/health/live` (processo) e `/health/ready` (banco, 503 quando cai). `GET /api/v1/metrics` no formato Prometheus, protegido por `METRICS_TOKEN`, com latência por rota (rota modelo, sem IDs). Logs com `requestId` em toda linha e sem senha, token ou cookie. |
| Backups | `scripts/backup.sh` (pg_dump verificado, retenção, cópia opcional para S3, anexos locais em tar.gz) e `scripts/restore.sh` (só em banco indicado de propósito, confirmação pelo nome, recria o papel). Procedimento, teste mensal, RPO/RTO e alertas em docs/OPERATIONS.md. |
| CI/CD | GitHub Actions nos dois repositórios. CI: typecheck, testes (API com PostgreSQL 16 real, no papel com RLS), build e conferência do openapi.json. Docker: imagem publicada no GHCR a cada push em `main` e em tags `v*`. O web ganhou imagem nginx sem root, com CSP, cabeçalhos de segurança, cache dos assets e fallback de SPA. |
| Deploy | docs/DEPLOY.md: variáveis, ordem do primeiro deploy, migrations como job separado (`npm run db:deploy`), proxy e TLS, health checks e rollback. O `docker-compose.yml` sobe banco, migrations e API com os dois papéis. |
| Fechamento sem corrida (pendência da Fase 4) | Cada lançamento segura um lock compartilhado do mês; o fechamento pega o mesmo lock de forma exclusiva e calcula o retrato depois dele. Um lançamento em andamento termina antes do fechamento, e um que chega depois espera e é recusado. |
| Fim do período de teste (pendência da Fase 5) | Rotina de hora em hora: teste vencido passa a "em atraso" (aparece no painel, não bloqueia) e fica auditado. Há lock no banco para várias réplicas; desliga com `JOBS_ENABLED=false`. |
| Web mais leve | Cada tela carrega sob demanda. O bundle inicial caiu de 909 kB para 244 kB, sem aviso de tamanho. Há tela de erro com recarregar quando sai uma versão nova. |
| Rotas da especificação (§22) | `/app/drivers`, `/app/routes` e `/app/maintenance` levam às abas certas de Operação e Custos. |

Um dono que queira excluir a conta pode antes dar o papel de dono a outro
membro na tela Equipe e sair da empresa; isso já existia.

Validação no navegador (celular 390 px e desktop 1366 px, API e web locais):
- O administrador abriu uma empresa sem autorização e viu "A empresa não
  autorizou acesso aos dados".
- O dono autorizou pelo celular. O administrador entrou como suporte e viu o
  painel com a faixa "Modo suporte · somente leitura", sem botões de cadastro.
- O dono viu "5 acessos" e a lista de páginas abertas. Revogou, e na
  navegação seguinte o administrador voltou ao painel da plataforma.
- Os dados pessoais de um motorista inativo foram removidos, e ele ficou com
  "Dados removidos".
- "Baixar meus dados" baixou `meus-dados-rotagest.json`. A exclusão da conta
  do dono foi bloqueada com a explicação.
- A política abriu pelo link do login.
- As três rotas novas caíram nas abas certas.
- Sem rolagem horizontal e sem erros no console.

Um corte do cartão de suporte na tela de Configurações do celular foi
encontrado e corrigido nessa validação. Capturas em
`rotagest-web/docs/screenshots/fase-6/`.

## Arquivos principais

**rotagest-api**
```
prisma/migrations/20261022120000_row_level_security/      papel rotagest_app, permissões e políticas
prisma/migrations/20261022150000_support_grants_privacy/  support_grants, anonymizedAt (users, drivers)
src/prisma/prisma.service.ts · prisma.module.ts            cliente com contexto de RLS
src/common/tenant/db-context.ts                            contexto por requisição (AsyncLocalStorage)
src/common/guards/tenant.guard.ts                          contexto, modo suporte somente leitura e auditado
src/common/tenant/tenant-resolver.service.ts              acesso de suporte autorizado
src/modules/support-access/                                autorização do dono, sessão de suporte
src/modules/privacy/                                       exportação e exclusão de conta
src/modules/fleet/                                         anonimização de motorista
src/modules/mail/ · attachments/ · health/ · metrics/      SMTP, S3, health, Prometheus
src/modules/transactions/period-lock.service.ts · closings/  lock entre lançamentos e fechamento
src/modules/subscriptions/trial-expiry.job.ts
scripts/db-app-role.js · backup.sh · restore.sh
.github/workflows/ · Dockerfile · docker-compose.yml
docs/DEPLOY.md · OPERATIONS.md · PRIVACY.md · SECURITY.md · ARCHITECTURE.md §5.4 e §5.7
test/rls.e2e-spec.ts · privacy-support.e2e-spec.ts · observability.e2e-spec.ts
```

**rotagest-web**
```
src/app/router.tsx                        carregamento sob demanda, telas de erro, rotas novas
src/features/support/                     cartão do dono, faixa do modo suporte
src/features/account/ · legal/            minha conta e política de privacidade
src/features/platform/companies-page.tsx  "Entrar como suporte"
src/features/fleet/                       remover dados pessoais do motorista
Dockerfile · nginx.conf · .github/workflows/
docs/screenshots/fase-6/
```

## Migrations

- `20261022120000_row_level_security`:
  - cria o papel `rotagest_app` sem login, com permissões e privilégios padrão para tabelas futuras;
  - revoga `_prisma_migrations` e `UPDATE`/`DELETE` em `audit_logs`;
  - `ENABLE` + `FORCE ROW LEVEL SECURITY` e a política em 31 tabelas.
- `20261022150000_support_grants_privacy`:
  - tabela `support_grants` (CHECK de até 72 h e de motivo com 10 a 500 caracteres, RLS);
  - coluna `anonymizedAt` em `users` e `drivers`.

**A migration de RLS muda como a API conecta.** Depois de aplicá-la, rode
`npm run db:app-role` e troque o `DATABASE_URL` para `rotagest_app` (ver
DEPLOY.md). O dono do banco passa a ficar só em `DIRECT_DATABASE_URL`.

Dependências novas na API (versões exatas): `nodemailer 10.0.13`,
`@aws-sdk/client-s3 3.1144.0`, `prom-client 15.1.3`. O `prisma` passou para
dependência de produção (migrations a partir da imagem).

## Testes

- API: **177** (domínio + e2e com PostgreSQL real, conectado como `rotagest_app`). Novos:
  - RLS:
    - papel sem privilégios;
    - nada visível sem contexto;
    - consulta sem filtro restrita à empresa;
    - gravação em outra empresa recusada;
    - modelos, SQL avulso e transações;
    - requisições concorrentes;
    - auditoria só inserção.
  - Acesso do suporte:
    - só o dono autoriza; prazo e motivo;
    - uma autorização por vez;
    - leitura com registro;
    - gravação recusada;
    - revogação imediata;
    - vencimento;
    - usuário comum fora.
  - LGPD:
    - exportação só com os dados do próprio usuário;
    - exclusão (senha, dono bloqueado, anonimização, sessões encerradas, e-mail liberado);
    - anonimização de motorista.
  - Infraestrutura e rotinas:
    - fechamento esperando um lançamento em andamento;
    - rotina de fim do teste;
    - seleção do transporte de e-mail;
    - driver S3 (cliente simulado);
    - health e métricas.
- Web: **52** testes, `tsc` e `vite build` ok (sem aviso de tamanho).
- Backup e restauração testados no PostgreSQL local: contagens iguais nas 38
  tabelas, políticas e permissões restauradas.

## Comandos

```bash
cd rotagest-api
npm install
DATABASE_URL=$DIRECT_DATABASE_URL npm run db:deploy   # migrations + senha do rotagest_app (APP_DB_PASSWORD)
npm test && npm run openapi:export
DIRECT_DATABASE_URL=... BACKUP_DIR=./backups scripts/backup.sh
cd ../rotagest-web
OPENAPI_SOURCE=../rotagest-api/openapi.json npm run api:types && npm run typecheck && npm test && npm run build
```

## Pendências

**Infraestrutura (precisa de você ou de um servidor):**
- Escolher onde hospedar e fazer o primeiro deploy (DEPLOY.md). Até aqui nada
  foi publicado em servidor.
- As imagens Docker não foram construídas aqui (sem Docker no ambiente). A
  primeira execução real do CI no GitHub vai validá-las.
- Contratar e configurar SMTP e o bucket S3. O driver S3 só foi testado com
  cliente simulado.
- Agendar o backup (cron/timer) e o alerta de idade do backup.
- Configurar Prometheus/alertas, ou usar o monitor do provedor.

**Negócio e jurídico:**
- Preencher os campos `[preencher: …]` da política: razão social, CNPJ,
  endereço, encarregado (DPO), provedores e data de vigência.
- Revisar a política com assessoria jurídica e escrever os termos de uso.
- Definir o prazo de expurgo de IP e navegador da auditoria.

**Produto:**
- Os recursos dos planos aparecem, mas ainda não liberam ou bloqueiam telas.
  Falta decidir o que acontece com quem já usa.
- Gateway de pagamento real: a interface está pronta, e a especificação pede
  para não simular cobrança.
- A exportação de relatórios continua síncrona. Uma fila só vale a pena com
  volumes que ainda não existem.
