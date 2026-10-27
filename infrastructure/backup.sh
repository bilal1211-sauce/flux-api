#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
backup_dir="${1:-.backups}"
mkdir -p "$backup_dir"
backup_file="$backup_dir/apiforge-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
docker compose --env-file infrastructure/.env -f infrastructure/compose.yaml exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_PASSWORD" exec mysqldump --user="$MYSQL_USER" --single-transaction --no-tablespaces --set-gtid-purged=OFF "$MYSQL_DATABASE"' | gzip > "$backup_file"
gzip -t "$backup_file"
printf 'Database backup created: %s\nKeep an encrypted copy of infrastructure/.env in a separate secret store; APP_KEY is required to restore secrets.\n' "$backup_file"
