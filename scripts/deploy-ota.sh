#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -e .env || -e ota-state/active.json ]]; then
  echo 'Existing deployment found; refusing to replace configuration. Follow docs/platform-updates.md.' >&2
  exit 1
fi
: "${PLATFORM_HOST:?Set PLATFORM_HOST}"
: "${GAMES_HOST:?Set GAMES_HOST}"
: "${ACME_EMAIL:?Set ACME_EMAIL}"
[[ "$PLATFORM_HOST" != "$GAMES_HOST" ]]
for value in "$PLATFORM_HOST" "$GAMES_HOST" "$ACME_EMAIL"; do
  if [[ "$value" == *$'\n'* || "$value" == *$'\r'* || "$value" == *' '* ]]; then
    echo 'Invalid deployment environment value' >&2
    exit 1
  fi
done
docker compose version
umask 077
mkdir -p ota-state backups
chmod 700 ota-state
chown 1000:1000 backups
chmod 755 backups
printf 'PLATFORM_HOST=%s\nGAMES_HOST=%s\nACME_EMAIL=%s\nDEPLOY_DIR=%s\nCOMPOSE_PROJECT_NAME=playroom\nUPDATE_REPOSITORY=%s\nUPDATE_BRANCH=main\nUPDATER_TOKEN=%s\nAPP_COMMIT=%s\n' \
  "$PLATFORM_HOST" "$GAMES_HOST" "$ACME_EMAIL" "$PWD" \
  "$(git remote get-url origin)" "$(openssl rand -hex 32)" "$(git rev-parse HEAD)" > .env
printf '%s\n' '{"services":{"app":{}}}' > ota-state/active.json
compose=(docker compose -f compose.yaml -f compose.ota.yaml -f ota-state/active.json)
"${compose[@]}" build
if [[ -z "${ADMIN_PASSWORD:-}" ]]; then
  ADMIN_PASSWORD="$(openssl rand -hex 24)"
  printf 'Username: admin\nPassword: %s\n' "$ADMIN_PASSWORD" > ota-state/initial-admin.txt
  echo 'Random administrator credentials saved to ota-state/initial-admin.txt (mode 600).'
fi
export ADMIN_PASSWORD
"${compose[@]}" run --rm --no-deps -e ADMIN_PASSWORD app npm run admin:init -- admin
unset ADMIN_PASSWORD
if [[ "${SEED_DEMOS:-0}" == '1' ]]; then
  "${compose[@]}" run --rm --no-deps app npm run demo:seed
fi
"${compose[@]}" up -d --wait --wait-timeout 180
echo "Platform: https://$PLATFORM_HOST"
