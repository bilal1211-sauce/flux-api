#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ $# -ne 2 || "$2" != "--replace-database" ]]; then
    printf 'Usage: bash infrastructure/restore.sh backup.sql.gz --replace-database\nThis replaces application tables. Stop writers and take a fresh backup first.\n' >&2
    exit 2
fi
gzip -t "$1"
gzip -dc "$1" | docker compose --env-file infrastructure/.env -f infrastructure/compose.yaml exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_PASSWORD" exec mysql --user="$MYSQL_USER" "$MYSQL_DATABASE"'
docker compose --env-file infrastructure/.env -f infrastructure/compose.yaml run --rm --no-deps api php artisan migrate --force
printf 'Restore complete. Verify APP_KEY, encrypted variables and account access before restarting writers.\n'
