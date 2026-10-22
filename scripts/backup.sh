#!/usr/bin/env bash
# Backup do RotaGest: dump do PostgreSQL (formato custom) e, com armazenamento
# local, um tar.gz dos comprovantes. Mantém os últimos BACKUP_KEEP arquivos de
# cada tipo e, com BACKUP_S3_URI, envia a cópia para fora do servidor.
#
#   DIRECT_DATABASE_URL=postgresql://dono:...@host:5432/rotagest scripts/backup.sh
#
# Usa a conexão do DONO do banco (DIRECT_DATABASE_URL). O papel da aplicação
# (rotagest_app) está sujeito ao Row-Level Security: um dump com ele sairia
# vazio ou incompleto sem nenhum erro.
#
# Variáveis:
#   DIRECT_DATABASE_URL  obrigatória; conexão do dono do banco
#   BACKUP_DIR           destino local (padrão ./backups)
#   BACKUP_KEEP          quantos backups manter localmente (padrão 14)
#   BACKUP_S3_URI        opcional; ex.: s3://meu-bucket/rotagest (exige o aws CLI)
#   S3_ENDPOINT          opcional; endpoint S3 compatível (MinIO, R2...)
#   STORAGE_DRIVER       local (padrão) ou s3; com s3 os comprovantes não entram aqui
#   STORAGE_DIR          diretório dos comprovantes (padrão ./storage)
#
# Detalhes, agendamento e restauração: docs/OPERATIONS.md
set -euo pipefail

log() { printf '[backup] %s\n' "$*"; }
fail() { printf '[backup] ERRO: %s\n' "$*" >&2; exit 1; }

: "${DIRECT_DATABASE_URL:?Defina DIRECT_DATABASE_URL (conexão do dono do banco, não do rotagest_app).}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
BACKUP_KEEP="${BACKUP_KEEP:-14}"
STORAGE_DRIVER="${STORAGE_DRIVER:-local}"
STORAGE_DIR="${STORAGE_DIR:-./storage}"

case "$BACKUP_KEEP" in
  '' | *[!0-9]* | 0) fail "BACKUP_KEEP deve ser um inteiro positivo (recebido: '$BACKUP_KEEP')." ;;
esac
command -v pg_dump >/dev/null 2>&1 || fail 'pg_dump não encontrado (instale o postgresql-client da mesma versão major do servidor).'

# O Prisma aceita ?schema=public na URL, mas o libpq (pg_dump) rejeita parâmetros desconhecidos.
pg_url() {
  printf '%s' "$1" | sed -E 's/([?&])schema=[^&]*&?/\1/; s/[?&]$//'
}

# Tamanho legível, sem depender de numfmt (ausente em algumas imagens).
human_size() {
  du -h "$1" | cut -f1
}

# Mantém só os $BACKUP_KEEP arquivos mais recentes que casam com o padrão.
prune() {
  local pattern="$1" old
  # Nomes com timestamp ordenam cronologicamente; ls -1 evita depender de find -printf.
  old=$(ls -1 "$BACKUP_DIR"/$pattern 2>/dev/null | sort -r | tail -n "+$((BACKUP_KEEP + 1))" || true)
  if [ -n "$old" ]; then
    printf '%s\n' "$old" | while IFS= read -r f; do
      rm -f -- "$f"
      log "removido (retenção): $(basename "$f")"
    done
  fi
}

upload() {
  local file="$1"
  [ -n "${BACKUP_S3_URI:-}" ] || return 0
  command -v aws >/dev/null 2>&1 || fail 'BACKUP_S3_URI definido, mas o aws CLI não está instalado.'
  local args=()
  [ -n "${S3_ENDPOINT:-}" ] && args+=(--endpoint-url "$S3_ENDPOINT")
  aws ${args[@]+"${args[@]}"} s3 cp --only-show-errors "$file" "${BACKUP_S3_URI%/}/$(basename "$file")"
  log "enviado: ${BACKUP_S3_URI%/}/$(basename "$file")"
}

mkdir -p "$BACKUP_DIR"
umask 077 # o dump contém dados pessoais e financeiros: só o dono do arquivo lê

stamp=$(date +%Y%m%d-%H%M%S)
dump="$BACKUP_DIR/rotagest-$stamp.dump"
tmp="$dump.partial"
trap 'rm -f -- "$tmp" "${tmp_tar:-}"' EXIT

log "dump do banco → $dump"
pg_dump --format=custom --no-password --file="$tmp" "$(pg_url "$DIRECT_DATABASE_URL")"
# Confere se o arquivo é um dump legível antes de considerá-lo válido.
pg_restore --list "$tmp" >/dev/null || fail 'o dump gerado não pôde ser lido pelo pg_restore.'
mv -- "$tmp" "$dump"
log "banco: $(human_size "$dump")"
upload "$dump"

if [ "$STORAGE_DRIVER" = "local" ]; then
  if [ -d "$STORAGE_DIR" ]; then
    archive="$BACKUP_DIR/rotagest-storage-$stamp.tar.gz"
    tmp_tar="$archive.partial"
    log "comprovantes ($STORAGE_DIR) → $archive"
    tar -czf "$tmp_tar" -C "$(dirname "$STORAGE_DIR")" "$(basename "$STORAGE_DIR")"
    mv -- "$tmp_tar" "$archive"
    log "comprovantes: $(human_size "$archive")"
    upload "$archive"
  else
    log "aviso: STORAGE_DIR '$STORAGE_DIR' não existe; comprovantes não incluídos."
  fi
else
  log "STORAGE_DRIVER=$STORAGE_DRIVER: comprovantes ficam no bucket (use versionamento/ciclo de vida do bucket)."
fi

prune 'rotagest-[0-9]*.dump'
prune 'rotagest-storage-[0-9]*.tar.gz'
log 'concluído.'
