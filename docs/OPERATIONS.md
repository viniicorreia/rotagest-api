# Operação do RotaGest: backups, restauração e monitoramento

Este guia cobre o dia a dia depois do deploy. Para publicar imagens, variáveis
de ambiente, migrations e rollback de versão, veja [`DEPLOY.md`](DEPLOY.md).

## 1. Backups

### O que os scripts fazem

| Script | O que faz |
| --- | --- |
| `scripts/backup.sh` | `pg_dump --format=custom` do banco em `BACKUP_DIR/rotagest-AAAAmmdd-HHMMSS.dump`, confere o arquivo com `pg_restore --list`, arquiva os comprovantes locais em `rotagest-storage-AAAAmmdd-HHMMSS.tar.gz`, envia os dois para `BACKUP_S3_URI` (se definido) e mantém só os últimos `BACKUP_KEEP` de cada tipo. |
| `scripts/restore.sh <arquivo.dump>` | `pg_restore --clean --if-exists --no-owner` em `RESTORE_DATABASE_URL`, com confirmação digitada do nome do banco. |

Variáveis do `backup.sh`:

| Variável | Padrão | Observação |
| --- | --- | --- |
| `DIRECT_DATABASE_URL` | (obrigatória) | Conexão do **dono** do banco. Nunca use a do `rotagest_app`: ele está sujeito ao Row-Level Security e o dump sairia vazio ou incompleto, sem erro. |
| `BACKUP_DIR` | `./backups` | Fora do repositório e fora do volume do banco. Os arquivos são criados com permissão `600`. |
| `BACKUP_KEEP` | `14` | Quantos backups manter localmente (por tipo). |
| `BACKUP_S3_URI` | (vazio) | Ex.: `s3://rotagest-backups/prod`. Exige o `aws` CLI. |
| `S3_ENDPOINT` | (vazio) | Endpoint S3 compatível (MinIO, Cloudflare R2...), passado como `--endpoint-url`. Credenciais pelas variáveis padrão do AWS CLI (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION`). |
| `STORAGE_DRIVER` | `local` | Com `local`, os comprovantes entram no backup; com `s3`, não (ver abaixo). |
| `STORAGE_DIR` | `./storage` | Diretório dos comprovantes, o mesmo da API. |

Requisitos no host que roda o backup: `bash`, `pg_dump`/`pg_restore` da mesma
versão major do servidor (PostgreSQL 16: pacote `postgresql-client-16`), `tar`
e, para a cópia externa, o `aws` CLI. A imagem da API traz os scripts, mas não o
cliente do PostgreSQL; sem instalar nada no host, use a imagem oficial:

```sh
docker run --rm --network <rede-do-banco> \
  -e DIRECT_DATABASE_URL -e BACKUP_DIR=/backups \
  -v /srv/rotagest/backups:/backups -v /srv/rotagest/storage:/storage -e STORAGE_DIR=/storage \
  -v "$PWD/scripts:/scripts:ro" postgres:16 /scripts/backup.sh
```

### Política

- **Frequência:** diária, de madrugada (fora do horário de uso das empresas). Faça
  também um backup manual **antes de cada deploy com migration**.
- **Retenção local:** 14 dias (`BACKUP_KEEP=14`), suficiente para restaurar
  rapidamente sem baixar nada.
- **Cópia fora do servidor (obrigatória):** `BACKUP_S3_URI` apontando para um
  bucket de **outra conta/projeto ou outro provedor**, com retenção maior no
  próprio bucket (ex.: 30 diários + 12 mensais, por regra de ciclo de vida) e,
  se possível, *object lock*/versionamento para que um invasor com acesso ao
  servidor não apague os backups.
- **Criptografia:** criptografia em repouso no bucket (SSE) e acesso restrito ao
  time de operação. Os dumps contêm dados pessoais (LGPD) e financeiros.

### O que entra e o que não entra

| Item | No backup? | Como proteger |
| --- | --- | --- |
| Tabelas, dados, índices, políticas de RLS, GRANTs | Sim (dump) | — |
| Comprovantes com `STORAGE_DRIVER=local` | Sim (tar.gz) | — |
| Comprovantes com `STORAGE_DRIVER=s3` | **Não** | Ative **versionamento** e regras de **ciclo de vida** no bucket (ex.: manter versões não atuais por 30 dias) e, se possível, replicação para outra região/conta. |
| Papéis do PostgreSQL (`rotagest_app`) e senhas | **Não** (papéis são do servidor, não do banco) | O `restore.sh` recria o papel sem login; depois rode `npm run db:app-role`. |
| Segredos do `.env` (`JWT_*`, `APP_DB_PASSWORD`, SMTP, S3, `METRICS_TOKEN`) | **Não** | Guarde num cofre de segredos (1Password, Vault, secret manager da nuvem), separado dos backups. Sem os mesmos segredos JWT, todos os usuários precisam logar de novo (não há perda de dados). |
| Imagens Docker | Não | Ficam no GHCR, por tag fixa (ver `DEPLOY.md`). |

### Agendamento

**cron** (usuário de sistema dedicado, ex.: `rotagest`):

```cron
# /etc/cron.d/rotagest-backup
30 3 * * * rotagest cd /srv/rotagest/api && . /etc/rotagest/backup.env && scripts/backup.sh >> /var/log/rotagest-backup.log 2>&1
```

**systemd timer** (preferível: registra no journal e avisa se a execução falhar):

```ini
# /etc/systemd/system/rotagest-backup.service
[Unit]
Description=Backup do RotaGest
After=network-online.target

[Service]
Type=oneshot
User=rotagest
WorkingDirectory=/srv/rotagest/api
EnvironmentFile=/etc/rotagest/backup.env
ExecStart=/srv/rotagest/api/scripts/backup.sh
```

```ini
# /etc/systemd/system/rotagest-backup.timer
[Unit]
Description=Backup diário do RotaGest

[Timer]
OnCalendar=*-*-* 03:30:00
RandomizedDelaySec=10m
Persistent=true

[Install]
WantedBy=timers.target
```

```sh
sudo systemctl daemon-reload && sudo systemctl enable --now rotagest-backup.timer
systemctl list-timers rotagest-backup.timer   # próxima execução
journalctl -u rotagest-backup.service -n 50   # última execução
```

`/etc/rotagest/backup.env` (permissão `600`, dono `rotagest`) contém
`DIRECT_DATABASE_URL`, `BACKUP_DIR`, `BACKUP_S3_URI`, `STORAGE_DIR` e as
credenciais do `aws` CLI. O script termina com código diferente de zero em
qualquer falha (`set -euo pipefail`): alerte sobre isso (seção 5).

## 2. Teste de restauração mensal

Backup que nunca foi restaurado não é backup. Uma vez por mês (e depois de
qualquer mudança na rotina de backup), em ambiente **isolado**:

1. Baixe o backup mais recente **da cópia externa** (não do servidor), para
   testar também o envio: `aws s3 cp s3://.../rotagest-AAAAmmdd-HHMMSS.dump .`
2. Crie um banco descartável num servidor que não seja o de produção:
   `createdb rotagest_restore_check`.
3. Restaure:

   ```sh
   RESTORE_DATABASE_URL=postgresql://dono:...@host-teste:5432/rotagest_restore_check \
     scripts/restore.sh rotagest-AAAAmmdd-HHMMSS.dump
   ```

4. Confira contagens com a produção no horário do dump (ou com o relatório do
   mês anterior): `companies`, `users`, `payables`, `receivables`,
   `account_transactions`, `audit_logs`, por empresa:

   ```sql
   SELECT c."tradeName", count(p.*) AS contas_a_pagar
   FROM companies c LEFT JOIN payables p ON p."companyId" = c.id
   GROUP BY c.id, c."tradeName" ORDER BY 1;
   ```

5. Suba uma API apontando para o banco restaurado (com `db:app-role` rodado) e
   faça um login real; abra um comprovante restaurado do tar.gz.
6. Anote no registro de operação: data, arquivo usado, duração da restauração
   (serve de base para o RTO) e problemas encontrados.
7. Apague o banco e os arquivos baixados: `dropdb rotagest_restore_check`.

## 3. RPO e RTO

- **RPO** (quanto dado se pode perder): com dump diário, **até 24 h**. Para
  reduzir, aumente a frequência do timer (ex.: a cada 6 h, `OnCalendar=*-*-* 00/6:30:00`)
  ou use um banco gerenciado com PITR (seção 4), que leva o RPO a minutos.
- **RTO** (quanto tempo até voltar): para o tamanho atual do banco, a
  restauração leva minutos; o tempo real vem do teste mensal. Some o tempo de
  baixar o dump, recriar o papel, rodar `db:app-role`, subir a API e validar.
  Meta sugerida: **até 2 h** em horário comercial.
- Revise as metas quando o banco crescer ou quando houver clientes com contrato
  de nível de serviço.

## 4. Alternativa: banco gerenciado

Em PostgreSQL gerenciado (AWS RDS/Aurora, Google Cloud SQL, Azure, Neon,
Supabase, DigitalOcean...), ative os **backups automáticos com PITR**
(*point-in-time recovery*): o provedor guarda os WAL e permite restaurar o banco
em qualquer instante da janela de retenção (geralmente 7 a 35 dias), numa
**instância nova**.

- Mesmo com PITR, mantenha o `backup.sh` diário com cópia em **outro provedor**
  ou outra conta: o PITR não protege contra exclusão da conta/instância nem
  contra erro de configuração no próprio provedor.
- A restauração PITR cria outra instância: aponte `DIRECT_DATABASE_URL`/
  `DATABASE_URL` para ela, rode `npm run db:app-role` (o papel normalmente vem
  junto no PITR, mas a senha deve ser conferida) e valide como no teste mensal.
- Restrições comuns: o usuário "dono" do provedor pode não ser superusuário;
  `pg_dump`/`pg_restore` com `--no-owner` já contornam isso.

## 5. Monitoramento

| Endpoint | Uso |
| --- | --- |
| `GET /api/v1/health/live` | *liveness*: o processo responde (não consulta o banco). |
| `GET /api/v1/health/ready` | *readiness*: 200 com o banco acessível, 503 caso contrário. |
| `GET /api/v1/metrics` | Formato Prometheus, com `Authorization: Bearer <METRICS_TOKEN>`. Sem `METRICS_TOKEN` configurado responde 404. Não exponha publicamente (ver `DEPLOY.md` §6). |

As métricas incluem as padrão do Node (CPU, memória, event loop, GC) e o
histograma `http_request_duration_seconds{method, route, status_code}`.

Exemplo de scrape:

```yaml
scrape_configs:
  - job_name: rotagest-api
    metrics_path: /api/v1/metrics
    authorization:
      credentials_file: /etc/prometheus/rotagest-metrics-token
    static_configs:
      - targets: ['api:3000']
```

Alertas sugeridos:

| Alerta | Condição (exemplo) |
| --- | --- |
| API não pronta | `ready` respondendo ≠ 200 por mais de 2 min (monitor externo de uptime) ou `up{job="rotagest-api"} == 0`. |
| Taxa de erros 5xx | `sum(rate(http_request_duration_seconds_count{status_code=~"5.."}[5m])) / sum(rate(http_request_duration_seconds_count[5m])) > 0.02` por 10 min. |
| Latência p95 | `histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket[5m]))) > 1` (1 s) por 10 min. |
| Disco | Volume do banco, de `storage` ou de `BACKUP_DIR` acima de 80% (node_exporter: `node_filesystem_avail_bytes`). |
| Idade do backup | Último `rotagest-*.dump` (local ou no bucket) com mais de 26 h, ou a unidade `rotagest-backup.service` em estado `failed`. Ex. de checagem: `find "$BACKUP_DIR" -name 'rotagest-*.dump' -mmin -1560 \| grep -q .` |

## 6. Incidente: restaurar após perda de dados

Use quando dados foram apagados ou corrompidos (erro humano, bug, ataque) ou o
banco foi perdido.

1. **Contenha.** Pare a escrita: tire a API do balanceador ou pare o contêiner
   (`docker compose stop api`). Se for ataque, troque antes as credenciais
   envolvidas.
2. **Registre** o horário do incidente, o que se sabe da causa e quem está
   conduzindo. Avise os clientes afetados se a indisponibilidade for longa.
3. **Preserve o estado atual** antes de mexer: rode `scripts/backup.sh` com um
   `BACKUP_DIR` separado (ex.: `./backups/incidente-AAAAmmdd`). Pode ser
   necessário para recuperar o que foi gravado depois do último backup.
4. **Escolha o ponto de restauração:** o último dump anterior ao problema (ou o
   instante exato, com PITR). Avalie a perda desde esse ponto (RPO).
5. **Restaure primeiro num banco novo** (`rotagest_restore`) e valide contagens e
   um login, como no teste mensal. Só então decida entre:
   - apontar `DIRECT_DATABASE_URL`/`DATABASE_URL` para o banco restaurado
     (preferível: mantém o banco danificado para análise); ou
   - restaurar sobre o banco de produção, que exige `--force`:

     ```sh
     RESTORE_DATABASE_URL="$DIRECT_DATABASE_URL" scripts/restore.sh --force rotagest-AAAAmmdd-HHMMSS.dump
     ```

6. **Papel da aplicação:** `APP_DB_PASSWORD=... npm run db:app-role` com
   `DIRECT_DATABASE_URL` apontando para o banco final.
7. **Migrations:** se o dump é de uma versão anterior, `npx prisma migrate deploy`
   aplica as que faltam (são aditivas).
8. **Comprovantes:** com armazenamento local, extraia o
   `rotagest-storage-*.tar.gz` do mesmo horário em `STORAGE_DIR`; com S3,
   recupere as versões anteriores dos objetos afetados pelo versionamento do
   bucket.
9. **Volte o tráfego** e confira `GET /api/v1/health/ready`, login, troca de
   empresa e download de um comprovante.
10. **Recupere o intervalo perdido**, se possível, a partir do backup do passo 3
    e dos `audit_logs`, e comunique às empresas o que precisa ser relançado.
11. **Pós-incidente:** registre a linha do tempo, a causa e as ações para não se
    repetir (frequência de backup, permissões, alertas).
