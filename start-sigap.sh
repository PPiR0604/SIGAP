#!/usr/bin/env bash
set -euo pipefail
root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$root"
docker info --format '{{.ServerVersion}}' >/dev/null 2>&1 || { echo 'Jalankan Docker terlebih dahulu.' >&2; exit 1; }
action=${1:-start}
if [ "$action" = cloud ]; then exec docker compose -f docker-compose.yml up -d --build; fi
envfile="$root/.env.sigap-local"
if [ "$action" = start ] && [ ! -f "$envfile" ]; then
 docker run --rm -it --mount "type=bind,source=$root,target=/work" -w /work node:22-alpine node deployment/local/setup.mjs
fi
[ -f "$envfile" ] || { echo 'Jalankan ./start-sigap.sh terlebih dahulu.' >&2; exit 1; }
# Shell variables take precedence over --env-file in Compose. Clear only the
# names owned by this isolated installation in this child shell.
while IFS='=' read -r name _; do
 [[ "$name" =~ ^[A-Z][A-Z0-9_]*$ ]] || continue
 unset "$name"
done < "$envfile"
compose=(docker compose -p sigap-local --env-file "$envfile" -f "$root/docker-compose.local.yml")
case "$action" in
 start)
  "${compose[@]}" up -d --build --wait --wait-timeout 900
  "${compose[@]}" run --rm --no-deps verify
  echo 'SIGAP: http://localhost:8080 | Akun: .sigap-local-accounts.txt | Inbox: http://localhost:8025'
  ;;
 stop) "${compose[@]}" down ;;
 status) "${compose[@]}" ps -a ;;
 verify) "${compose[@]}" run --rm --no-deps verify ;;
 reset)
  [ "${2:-}" = '--confirm-local-reset' ] || { echo 'Reset menghapus data SIGAP lokal. Tambahkan --confirm-local-reset untuk melanjutkan.' >&2; exit 1; }
  echo 'Menghapus volume proyek sigap-local.'
  "${compose[@]}" down --volumes --remove-orphans
  ;;
 *) echo 'Gunakan start, stop, status, verify, reset, atau cloud.' >&2; exit 2 ;;
esac
