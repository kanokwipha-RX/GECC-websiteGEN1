#!/usr/bin/env bash
# Run on the Linux hosting server, outside the public document root.
set -Eeuo pipefail
umask 077
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd -- "$ROOT"
trap 'printf "Stopped at line %s; earlier steps may already be complete. Review the error before retrying. Do not delete volumes.\n" "$LINENO" >&2' ERR

usage() {
  cat <<'HELP'
Usage: bash deploy/production.sh COMMAND [--apply]
  check           Read-only host capability check; requires Linux + Docker Compose.
  init --apply    Build, initialize missing schema/state, provision missing accounts,
                  and start/recreate the backend on localhost. Existing data remains.
  start --apply   Start/recreate the existing backend; no build/migration/provisioning.
  status          Display container status (no secrets).
  smoke [URL]     Read-only check of the public HTTPS site (after Apache setup).

init creates .env only if missing. Credentials stay in var/private/accounts.json.
No software installation, Apache changes, git pull, database reset or real-data import.
For an existing live installation, take a consistent database/files backup first.
HELP
}

require_docker() {
  [[ "$(uname -s)" == Linux ]] || { echo 'Run this script through SSH on the Linux hosting server.' >&2; return 1; }
  command -v docker >/dev/null || { echo 'Docker is required; ask the hosting team to install/enable it.' >&2; return 1; }
  docker compose version >/dev/null
  docker info >/dev/null
}
compose() {
  docker compose --project-directory "$ROOT" --env-file "$ROOT/.env" -f "$ROOT/compose.yaml" "$@"
}
existing_config() {
  [[ -f .env ]] || { echo 'Missing .env; run init --apply first.' >&2; return 1; }
  compose config --quiet
}
lock_setup() {
  command -v flock >/dev/null || { echo 'flock (util-linux) is required to prevent concurrent setup.' >&2; return 1; }
  mkdir -p var
  exec 9>var/production.lock
  flock -n 9 || { echo 'Another setup/start command is already running.' >&2; return 1; }
}
private_command() {
  compose run --rm --no-deps --user "$(id -u):$(id -g)" \
    --volume "$ROOT/var/private:/app/var/private" web node server/accounts.js "$@" var/private/accounts.json
}

command="${1:-help}"
case "$command" in
  help|--help|-h) usage ;;
  check)
    bash deploy/check-host.sh
    require_docker
    for tool in openssl flock; do
      command -v "$tool" >/dev/null || { printf '%s is required for initialization.\n' "$tool" >&2; exit 1; }
    done
    printf 'Docker prerequisites passed. Public routing/database readiness still need verification.\n'
    ;;
  init)
    [[ "${2:-}" == --apply ]] || { usage; exit 2; }
    require_docker
    lock_setup
    if [[ ! -f .env ]]; then
      command -v openssl >/dev/null || { echo 'OpenSSL is required to generate a database password.' >&2; exit 1; }
      password="$(openssl rand -hex 32)"
      [[ "$password" =~ ^[0-9a-f]{64}$ ]] || { echo 'Password generation failed.' >&2; exit 1; }
      # Exclusive creation; never replace existing host credentials.
      (set -o noclobber; cat > .env <<ENV
COMPOSE_PROJECT_NAME=gecc2570
POSTGRES_PASSWORD=$password
APP_ORIGIN=https://www.osscsskfda.org
BASE_PATH=/sskgecc
WEB_PORT=8080
ENV
      )
      unset password
      printf 'Created private .env with a random database password.\n'
    fi
    existing_config
    chmod 600 .env
    mkdir -p var/private
    chmod 700 var/private
    compose build web
    compose up -d --wait db
    compose run --rm --no-deps web node server/manage.js migrate
    if [[ ! -f var/private/accounts.json ]]; then
      private_command prepare
    fi
    private_command check
    private_command apply
    compose up -d --wait web
    compose ps
    printf '\nBackend started. Account credentials: var/private/accounts.json (private).\n'
    printf 'Configure Apache using deploy/apache-sskgecc.conf, then run: bash deploy/production.sh smoke\n'
    ;;
  start)
    [[ "${2:-}" == --apply ]] || { usage; exit 2; }
    require_docker
    lock_setup
    existing_config
    compose up -d --wait web
    ;;
  status)
    require_docker
    existing_config
    compose ps
    ;;
  smoke)
    require_docker
    existing_config
    compose run --rm --no-deps web node server/check-production.js "${2:-https://www.osscsskfda.org/sskgecc/}"
    ;;
  *) usage; exit 2 ;;
esac
