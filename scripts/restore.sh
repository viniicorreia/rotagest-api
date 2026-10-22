#!/usr/bin/env bash
# Restaura um dump do RotaGest (gerado por scripts/backup.sh) em um banco
# EXPLICITAMENTE indicado em RESTORE_DATABASE_URL.
#
#   RESTORE_DATABASE_URL=postgresql://dono:...@host:5432/rotagest_restore scripts/restore.sh backups/rotagest-20261022-030000.dump
#
# Proteções:
#   - não há padrão: sem RESTORE_DATABASE_URL o script para;
#   - se RESTORE_DATABASE_URL for o mesmo banco de DIRECT_DATABASE_URL ou
#     DATABASE_URL (produção), exige --force;
#   - sempre pede que o operador digite o nome do banco de destino.
#
# Usa pg_restore --clean --if-exists --no-owner: os objetos do dump substituem
# os existentes e passam a pertencer ao usuário da conexão. Papéis (rotagest_app)
# e senhas NÃO estão no dump: depois rode `npm run db:app-role`.
# Procedimento completo: docs/OPERATIONS.md
set -euo pipefail

log() { printf '[restore] %s\n' "$*"; }
fail() { printf '[restore] ERRO: %s\n' "$*" >&2; exit 1; }
usage() { printf 'Uso: RESTORE_DATABASE_URL=... %s [--force] <arquivo.dump>\n' "$0" >&2; exit 2; }

force=0
file=''
for arg in "$@"; do
  case "$arg" in
    --force) force=1 ;;
    -h | --help) usage ;;
    -*) usage ;;
    *) [ -z "$file" ] || usage; file="$arg" ;;
  esac
done
[ -n "$file" ] || usage
[ -f "$file" ] || fail "arquivo não encontrado: $file"
: "${RESTORE_DATABASE_URL:?Defina RESTORE_DATABASE_URL com o banco de destino (não há padrão, de propósito).}"
command -v pg_restore >/dev/null 2>&1 || fail 'pg_restore não encontrado (instale o postgresql-client).'
command -v psql >/dev/null 2>&1 || fail 'psql não encontrado (instale o postgresql-client).'

# O Prisma aceita ?schema=public na URL, mas o libpq rejeita parâmetros desconhecidos.
pg_url() {
  printf '%s' "$1" | sed -E 's/([?&])schema=[^&]*&?/\1/; s/[?&]$//'
}

# Identidade do banco como o servidor a vê (host:porta/banco), para comparar URLs escritas de jeitos diferentes.
db_identity() {
  psql "$(pg_url "$1")" --no-password -XAtq -c "SELECT coalesce(inet_server_addr()::text, 'local') || ':' || current_setting('port') || '/' || current_database()" 2>/dev/null || true
}

target_url=$(pg_url "$RESTORE_DATABASE_URL")
pg_restore --list "$file" >/dev/null || fail "$file não é um dump válido do pg_dump (formato custom)."
target_db=$(psql "$target_url" --no-password -XAtq -c 'SELECT current_database()') || fail 'não foi possível conectar em RESTORE_DATABASE_URL.'
target_id=$(db_identity "$RESTORE_DATABASE_URL")

for var in DIRECT_DATABASE_URL DATABASE_URL; do
  other="${!var:-}"
  [ -n "$other" ] || continue
  same=0
  [ "$(pg_url "$other")" = "$target_url" ] && same=1
  [ "$same" = 0 ] && [ -n "$target_id" ] && [ "$(db_identity "$other")" = "$target_id" ] && same=1
  if [ "$same" = 1 ]; then
    [ "$force" = 1 ] || fail "RESTORE_DATABASE_URL aponta para o mesmo banco de $var ($target_db). Isso sobrescreve dados em uso; se é mesmo o que quer (incidente), repita com --force."
    log "ATENÇÃO: destino é o mesmo banco de $var (--force informado)."
  fi
done

log "arquivo: $file ($(du -h "$file" | cut -f1))"
log "destino: banco '$target_db' ($target_id)"
log 'Os objetos do dump vão SUBSTITUIR os existentes no destino (--clean).'
printf '[restore] Digite o nome do banco de destino para confirmar: ' >&2
read -r answer || answer=''
[ "$answer" = "$target_db" ] || fail 'confirmação não confere; nada foi alterado.'

# O dump traz GRANTs e políticas para rotagest_app, mas não o papel (papéis são do
# servidor, não do banco). Num servidor novo, cria o papel como a migration de RLS
# cria: sem login, sem BYPASSRLS. O login é liberado depois pelo db:app-role.
has_role=$(psql "$target_url" --no-password -XAtq -c "SELECT 1 FROM pg_roles WHERE rolname = 'rotagest_app'")
if [ "$has_role" != 1 ]; then
  log 'papel rotagest_app não existe neste servidor; criando (NOLOGIN, sem BYPASSRLS).'
  psql "$target_url" --no-password -Xq -v ON_ERROR_STOP=1 \
    -c 'CREATE ROLE rotagest_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS' \
    || fail 'não foi possível criar o papel rotagest_app (o usuário da conexão precisa de CREATEROLE).'
fi

log 'restaurando...'
pg_restore --clean --if-exists --no-owner --no-password --exit-on-error --single-transaction \
  --dbname="$target_url" "$file"
log 'restauração concluída.'
cat >&2 <<'MSG'
[restore] PRÓXIMOS PASSOS:
  1. Papéis e senhas não estão no dump. Com DIRECT_DATABASE_URL apontando para
     este banco, rode:  APP_DB_PASSWORD=... npm run db:app-role
     (libera o login do rotagest_app; as políticas e GRANTs vieram do dump).
  2. Confira contagens por empresa e um login real antes de liberar o tráfego.
  3. Comprovantes (STORAGE_DRIVER=local): extraia o rotagest-storage-*.tar.gz
     do mesmo horário em STORAGE_DIR.
MSG
