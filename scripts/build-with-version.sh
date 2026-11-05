#!/usr/bin/env bash
# Builds the app image from this checkout (instead of pulling the published
# one), stamped with the git version so Admin -> System health reports what is
# running. Run the result with the same override:
#
#   ./scripts/build-with-version.sh
#   docker compose -f docker-compose.yml -f docker-compose.build.yml up -d
set -euo pipefail

cd "$(dirname "$0")/.."

if git rev-parse --git-dir >/dev/null 2>&1; then
  TROVE_BUILD_VERSION="${TROVE_BUILD_VERSION:-$(git describe --tags --always --dirty 2>/dev/null || echo "")}"
  TROVE_BUILD_COMMIT="${TROVE_BUILD_COMMIT:-$(git rev-parse HEAD 2>/dev/null || echo "")}"
fi
TROVE_BUILT_AT="${TROVE_BUILT_AT:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
export TROVE_BUILD_VERSION TROVE_BUILD_COMMIT TROVE_BUILT_AT

echo "Building $TROVE_BUILD_VERSION (${TROVE_BUILD_COMMIT:0:7}), $TROVE_BUILT_AT"
exec docker compose -f docker-compose.yml -f docker-compose.build.yml build "$@"
