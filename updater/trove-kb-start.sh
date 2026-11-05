#!/usr/bin/env bash
# Starts the bare-metal app: the release `current` points at, with the
# checkout's .env. Run by trove-kb.service; the same steps the container's
# entrypoint takes (migrations, optional seed, then the server).
set -euo pipefail

DIR="${TROVE_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ENV_FILE="$DIR/.env"
RELEASE="$DIR/current"

if [ ! -f "$RELEASE/server.js" ]; then
  echo "trove-kb: no release at $RELEASE; run updater/install-updater.sh --mode bare-metal" >&2
  exit 1
fi

# Read KEY from .env without sourcing it, as the updater does.
env_get() {
  sed -n "s/^$1=//p" "$ENV_FILE" | tail -n1 | sed -e 's/[[:space:]]#.*$//' -e 's/[[:space:]]*$//' \
    -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}

# Which build this is, for Admin -> System health and the updater's check.
while IFS='=' read -r key value; do
  case "$key" in TROVE_BUILD_VERSION | TROVE_BUILD_COMMIT | TROVE_BUILT_AT) export "$key=$value" ;; esac
done <"$RELEASE/BUILD_INFO"

# The container listens on 3000 behind APP_PORT; here the app is the listener.
APP_PORT_VALUE="$(env_get APP_PORT)"
APP_BIND_VALUE="$(env_get APP_BIND)"
export PORT="${APP_PORT_VALUE:-3080}"
export HOSTNAME="${APP_BIND_VALUE:-0.0.0.0}"
export NODE_ENV=production
export NEXT_TELEMETRY_DISABLED=1

cd "$RELEASE"
echo "trove-kb: applying database migrations"
node --env-file="$ENV_FILE" dist/migrate.js

if [ "$(env_get SEED_ON_START)" = "true" ]; then
  echo "trove-kb: seeding starter data"
  node --env-file="$ENV_FILE" dist/seed.js
fi

echo "trove-kb: starting ${TROVE_BUILD_VERSION:-} on $HOSTNAME:$PORT"
exec node --env-file="$ENV_FILE" server.js
