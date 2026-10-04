#!/usr/bin/env bash
set -euo pipefail
volume="playroom-ci-${GITHUB_RUN_ID:-local}-$$"
container="${volume}-app"
cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
  docker volume rm "$volume-backup" "$volume-restored" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker volume create "$volume" >/dev/null
common=(-e NODE_ENV=development -e PLATFORM_ORIGIN=http://localhost:3000 -e GAMES_ORIGIN=http://127.0.0.1:3001 -v "$volume:/data")
docker run --rm "${common[@]}" playroom:test npm run demo:seed
docker run --rm "${common[@]}" -v "$volume-backup:/backups" playroom:test npm run backup -- /backups/snapshot
docker run --rm -e NODE_ENV=development -v "$volume-restored:/data" -v "$volume-backup:/backups:ro" playroom:test npm run restore -- /backups/snapshot
docker run -d --name "$container" "${common[@]}" playroom:test >/dev/null
for i in $(seq 1 30); do
  if docker exec "$container" node -e "fetch('http://localhost:3000/api/v1/games').then(async r=>{if((await r.json()).games.length!==2)process.exit(1)}).catch(()=>process.exit(1))"; then break; fi
  sleep 1
done
docker restart "$container" >/dev/null
for i in $(seq 1 30); do
  if docker exec "$container" node -e "fetch('http://localhost:3000/api/v1/games').then(async r=>{if((await r.json()).games.length!==2)process.exit(1)}).catch(()=>process.exit(1))"; then exit 0; fi
  sleep 1
done
exit 1
