#!/usr/bin/env bash
# Trove KB host updater. Run by updater/trove-kb-update.timer every 10 minutes
# on the server, outside the app, as an ordinary user: the app never gets
# Docker, git or systemd access. Install with updater/install-updater.sh.
#
# Two ways of running the app, set by TROVE_DEPLOY_MODE in .env:
#   docker      the compose stack runs published images; this pins
#               TROVE_IMAGE_TAG and restarts it. The user is in the docker
#               group; nothing runs as root.
#   bare-metal  the app runs as the trove-kb systemd service from
#               releases/<version>, which this builds from the checkout with
#               npm, then points `current` at. The only privilege is a sudoers
#               line allowing `systemctl restart trove-kb.service`.
#
# Each run:
#   1. Reads the administrator's policy (Admin -> System health):
#      channel = production | development | manual, update hour, update now.
#   2. Works out the target: the newest release tag (production) or the tip
#      of origin/dev (development). Manual only reports what is available.
#   3. At the update hour, or when an administrator pressed "Update now", and
#      when the target is newer: backs up the database, deploys the target,
#      and waits for the app to report the new commit. If it doesn't, rolls
#      back to the previous build.
#   4. Reports the outcome, with the change files (changes/*.md) the target
#      adds, so administrators can preview what is coming.
#
# Never moves to an older build: the target must descend from the running
# commit (migrations only go forward).
#
# By hand: updater/trove-kb-update.sh --install <tag|commit|HEAD> deploys that
# build now, whatever the channel (the installer uses it for the first
# bare-metal release).
#
# Environment overrides: TROVE_DIR (checkout, default: this script's repo),
# TROVE_URL (default http://127.0.0.1:$APP_PORT), TROVE_REMOTE (default
# origin), TROVE_HEALTH_TIMEOUT (seconds, default 300), TROVE_SERVICE
# (bare metal, default trove-kb.service), TROVE_KEEP_RELEASES (default 3).

set -euo pipefail

# Everything lives in main(), which bash reads in full before running: the
# checkout (this file included) changes underneath us mid-run.
main() {
  DIR="${TROVE_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
  cd "$DIR"

  INSTALL_REF=""
  if [ "${1:-}" = "--install" ]; then
    INSTALL_REF="${2:-}"
    if [ -z "$INSTALL_REF" ]; then
      echo "usage: $0 --install <tag|commit|HEAD>" >&2
      return 2
    fi
  fi

  if [ ! -f "$DIR/.env" ]; then
    log "no $DIR/.env; set the app up first"
    return 1
  fi

  MODE="$(env_get TROVE_DEPLOY_MODE)"
  MODE="${MODE:-docker}"
  case "$MODE" in docker | bare-metal) ;; *)
    log "TROVE_DEPLOY_MODE must be docker or bare-metal, not '$MODE'"
    return 1
    ;;
  esac

  local port bind
  port="$(env_get APP_PORT)"
  bind="$(env_get APP_BIND)"
  case "$bind" in "" | 0.0.0.0 | "::") bind=127.0.0.1 ;; esac
  URL="${TROVE_URL:-http://$bind:${port:-3080}}"
  REMOTE="${TROVE_REMOTE:-origin}"
  HEALTH_TIMEOUT="${TROVE_HEALTH_TIMEOUT:-300}"
  SERVICE="${TROVE_SERVICE:-trove-kb.service}"
  KEEP_RELEASES="${TROVE_KEEP_RELEASES:-3}"

  # One run at a time.
  exec 9>"$DIR/.trove-update.lock"
  if ! flock -n 9; then
    log "another update run is in progress; skipping"
    return 0
  fi

  TOKEN="$(env_get TROVE_UPDATER_TOKEN)"
  if [ -z "$TOKEN" ]; then
    log "TROVE_UPDATER_TOKEN missing from $DIR/.env; run updater/install-updater.sh"
    return 1
  fi

  CHANNEL=manual
  UPDATE_HOUR=3
  UPDATE_NOW=0
  CURRENT_TAG=""
  CURRENT_COMMIT=""
  HANDLED=0
  AVAILABLE=""
  PENDING_ARGS=()

  local policy=""
  if policy="$(curl -fsS -m 20 -H "Authorization: Bearer $TOKEN" "$URL/api/internal/updates/policy" 2>/dev/null)"; then
    CHANNEL="$(policy_get channel <<<"$policy")"
    UPDATE_HOUR="$(policy_get update_hour <<<"$policy")"
    UPDATE_NOW="$(policy_get update_now <<<"$policy")"
    CURRENT_TAG="$(policy_get running_version <<<"$policy")"
    CURRENT_COMMIT="$(policy_get running_commit <<<"$policy")"
  elif [ -z "$INSTALL_REF" ]; then
    log "could not read the update policy from $URL (is the app up?)"
    return 1
  fi
  [ "$CURRENT_COMMIT" = unknown ] && CURRENT_COMMIT=""
  # A build that wasn't stamped (built by hand) reports no commit: the checkout
  # is the best guess, and only "it answers" can prove a rollback healthy.
  STAMPED=1
  if [ -z "$CURRENT_COMMIT" ]; then
    STAMPED=0
    CURRENT_COMMIT="$(git rev-parse HEAD)"
  fi
  CURRENT_TAG="${CURRENT_TAG:-unknown}"
  PREVIOUS_IMAGE_TAG="$(env_get TROVE_IMAGE_TAG)"
  PREVIOUS_IMAGE_TAG="${PREVIOUS_IMAGE_TAG:-stable}"

  # The remote is the source of truth for release tags: --force/--prune-tags
  # replace local tags that differ instead of rejecting them. Not --quiet: it
  # hides git's reasons, so a failure would report no cause at all.
  local fetch_out fetch_rc=0
  fetch_out="$(git fetch --prune --prune-tags --force --tags "$REMOTE" 2>&1)" || fetch_rc=$?
  if [ "$fetch_rc" != 0 ]; then
    report waiting "git fetch from $REMOTE failed (exit $fetch_rc): $(printf '%s\n' "$fetch_out" | grep -v '^[[:space:]]*$' | head -n 3 | tr '\n' ' ' | head -c 400)"
    return 1
  fi
  local latest_release
  latest_release="$(git tag -l 'v[0-9]*.[0-9]*.[0-9]*' --sort=-v:refname | grep -v -- '-' | head -n1 || true)"

  local target_commit target_tag
  if [ -n "$INSTALL_REF" ]; then
    if ! target_commit="$(git rev-parse --verify --quiet "$INSTALL_REF^{commit}")"; then
      log "$INSTALL_REF is not a tag or commit in this checkout"
      return 1
    fi
    target_tag="$(release_tag_of "$target_commit" "$INSTALL_REF")"
    AVAILABLE="$target_tag"
    UPDATE_NOW=1
  else
    case "$CHANNEL" in
      manual)
        AVAILABLE="$latest_release"
        if [ -n "$latest_release" ]; then
          collect_pending "$(git rev-parse "refs/tags/$latest_release^{commit}")"
        fi
        report manual "Manual updates: the newest release is ${latest_release:-not published yet}."
        return 0
        ;;
      production)
        if [ -z "$latest_release" ]; then
          report waiting "No release has been published yet."
          return 0
        fi
        target_commit="$(git rev-parse "refs/tags/$latest_release^{commit}")"
        target_tag="$latest_release"
        ;;
      development)
        target_commit="$(git rev-parse "refs/remotes/$REMOTE/dev")"
        target_tag="dev-${target_commit:0:7}"
        ;;
      *)
        log "unknown channel '$CHANNEL' in policy"
        return 1
        ;;
    esac
    AVAILABLE="$target_tag"
  fi
  collect_pending "$target_commit"

  if [ "$target_commit" = "$CURRENT_COMMIT" ] && [ "$target_tag" = "$CURRENT_TAG" ]; then
    [ "$UPDATE_NOW" = 1 ] && HANDLED=1
    report up_to_date "Running $target_tag, the newest $CHANNEL build."
    return 0
  fi

  local hour
  hour="$(date +%H)"
  if [ "$UPDATE_NOW" != 1 ] && [ "$((10#$hour))" != "$UPDATE_HOUR" ]; then
    report waiting "$target_tag is available; it installs at $(printf '%02d' "$UPDATE_HOUR"):00 server time."
    return 0
  fi
  [ "$UPDATE_NOW" = 1 ] && HANDLED=1

  # Don't retry a build that already failed here every 10 minutes for the rest
  # of the hour (each attempt restarts the app). A newer build, or "Update
  # now", clears it.
  FAILED_FILE="$DIR/.trove-update.failed"
  if [ "$UPDATE_NOW" != 1 ] && [ "$(cat "$FAILED_FILE" 2>/dev/null)" = "$target_tag" ]; then
    report waiting "$target_tag failed to install earlier (see the update history); skipping it until a newer $CHANNEL build or Update now."
    return 0
  fi

  if git cat-file -e "$CURRENT_COMMIT^{commit}" 2>/dev/null &&
    ! git merge-base --is-ancestor "$CURRENT_COMMIT" "$target_commit"; then
    report waiting "$target_tag is not newer than the running build ($CURRENT_TAG at ${CURRENT_COMMIT:0:7}), so it would be a downgrade. Waiting for a newer $CHANNEL build."
    return 0
  fi

  if ! git diff --quiet HEAD --; then
    echo "$target_tag" >"$FAILED_FILE"
    report failed "The checkout at $DIR has local changes to tracked files; not updating. Commit or discard them." "$CURRENT_TAG" "$target_tag"
    return 1
  fi

  # Get the new build ready while the old one keeps serving.
  if [ "$MODE" = docker ]; then
    # Images come from CI a few minutes after a push; if they aren't there
    # yet, try again next run.
    if ! TROVE_IMAGE_TAG="$target_tag" docker compose pull --quiet app; then
      HANDLED=0
      report waiting "The image for $target_tag isn't published yet (or the registry is unreachable); retrying next run."
      return 0
    fi
  else
    local build_log
    if ! build_log="$(build_release "$target_commit" "$target_tag" 2>&1)"; then
      echo "$target_tag" >"$FAILED_FILE"
      report failed "Building $target_tag failed; still running $CURRENT_TAG. $(printf '%s\n' "$build_log" | tail -n 5 | tr '\n' ' ' | head -c 600)" "$CURRENT_TAG" "$target_tag"
      return 1
    fi
  fi

  log "updating $CURRENT_TAG (${CURRENT_COMMIT:0:7}) -> $target_tag (${target_commit:0:7})"
  local previous_release=""
  [ "$MODE" = bare-metal ] && previous_release="$(readlink "$DIR/current" 2>/dev/null || true)"
  local previous_checkout
  previous_checkout="$(git rev-parse HEAD)"

  if [ "$MODE" = docker ] || [ -n "$previous_release" ]; then
    if ! backup "$CURRENT_TAG"; then
      echo "$target_tag" >"$FAILED_FILE"
      report failed "Pre-update database backup failed; not updating. $BACKUP_ERROR" "$CURRENT_TAG" "$target_tag"
      return 1
    fi
  fi

  # A failed start is caught by the health check, which rolls back.
  deploy "$target_commit" "$target_tag" || log "deploying $target_tag failed"
  if wait_healthy "$target_commit"; then
    rm -f "$FAILED_FILE"
    prune
    PENDING_ARGS=(--data-urlencode "pending_changes_sent=1")
    report updated "Updated $CURRENT_TAG -> $target_tag." "$CURRENT_TAG" "$target_tag"
    return 0
  fi

  echo "$target_tag" >"$FAILED_FILE"
  if [ "$MODE" = bare-metal ] && [ -z "$previous_release" ]; then
    report failed "$target_tag did not come up healthy, and there is no earlier release to go back to. Check 'journalctl -u $SERVICE'." "" "$target_tag" || true
    return 1
  fi

  log "$target_tag did not come up healthy; rolling back to $CURRENT_TAG"
  if [ "$MODE" = docker ]; then
    deploy "$previous_checkout" "$PREVIOUS_IMAGE_TAG" || log "redeploying $CURRENT_TAG failed"
  else
    git checkout --quiet --detach "$previous_checkout"
    switch_current "$previous_release"
    restart_service || log "restarting $SERVICE failed"
  fi
  local rollback_commit="$CURRENT_COMMIT"
  [ "$STAMPED" = 1 ] || rollback_commit=""
  if wait_healthy "$rollback_commit"; then
    report rolled_back "$target_tag did not pass its health check; rolled back to $CURRENT_TAG. The pre-update backup is in backups/." "$CURRENT_TAG" "$target_tag"
  else
    report failed "$target_tag failed its health check and the rollback to $CURRENT_TAG did not come up either. Check $(logs_hint). The pre-update backup is in backups/." "$CURRENT_TAG" "$target_tag" || true
  fi
  return 1
}

log() { echo "trove-kb-update: $*"; }

# Read KEY from .env without sourcing it (values may hold shell syntax).
env_get() {
  [ -f "$DIR/.env" ] || return 0
  sed -n "s/^$1=//p" "$DIR/.env" | tail -n1 | sed -e 's/[[:space:]]#.*$//' -e 's/[[:space:]]*$//' \
    -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}

# Set KEY=value in .env, replacing an existing line or appending one.
env_set() {
  if grep -q "^$1=" "$DIR/.env"; then
    sed -i "s|^$1=.*|$1=$2|" "$DIR/.env"
  else
    printf '%s=%s\n' "$1" "$2" >>"$DIR/.env"
  fi
}

policy_get() { sed -n "s/^$1=//p" | head -n1; }

logs_hint() {
  if [ "$MODE" = docker ]; then echo "'docker compose logs app'"; else echo "'journalctl -u $SERVICE'"; fi
}

# The release tag a commit was published as, else dev-<sha7>.
release_tag_of() {
  local commit="$1" ref="$2" tag
  if [[ "$ref" =~ ^v[0-9]+\.[0-9]+\.[0-9]+ ]] && [ "$(git rev-parse "refs/tags/$ref^{commit}" 2>/dev/null)" = "$commit" ]; then
    echo "$ref"
    return
  fi
  tag="$(git tag --points-at "$commit" -l 'v[0-9]*.[0-9]*.[0-9]*' --sort=-v:refname | head -n1)"
  echo "${tag:-dev-${commit:0:7}}"
}

# report STATUS MESSAGE [PREVIOUS_VERSION TARGET_VERSION]
report() {
  local status="$1" message="$2"
  log "$status: $message"
  curl -fsS -m 20 -o /dev/null -H "Authorization: Bearer $TOKEN" \
    --data-urlencode "status=$status" \
    --data-urlencode "message=$message" \
    --data-urlencode "channel=$CHANNEL" \
    --data-urlencode "mode=$MODE" \
    --data-urlencode "previous_version=${3:-}" \
    --data-urlencode "target_version=${4:-}" \
    --data-urlencode "current_version=$CURRENT_TAG" \
    --data-urlencode "current_commit=${CURRENT_COMMIT:0:12}" \
    --data-urlencode "available_version=${AVAILABLE:-}" \
    --data-urlencode "host_time=$(date -Iseconds)" \
    --data-urlencode "host_tz=$(date +%Z)" \
    --data-urlencode "handled_request=$HANDLED" \
    ${PENDING_ARGS[@]+"${PENDING_ARGS[@]}"} \
    "$URL/api/internal/updates/report" || log "could not send the report to $URL"
}

# Change files the target commit adds over the running one, as report fields
# ("<name>\n<contents>"). Nothing when the target isn't newer. Stops at about
# 30 KB of text; pending_changes_total still counts every file.
collect_pending() {
  PENDING_ARGS=(--data-urlencode "pending_changes_sent=1")
  git merge-base --is-ancestor "$CURRENT_COMMIT" "$1" 2>/dev/null || return 0
  local files f body size=0 total=0
  files="$(git diff --no-renames --name-only --diff-filter=A "$CURRENT_COMMIT" "$1" -- changes/ |
    grep '\.md$' | grep -vi '/readme\.md$' || true)"
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    total=$((total + 1))
    [ "$size" -lt 30000 ] || continue
    body="$(git show "$1:$f" 2>/dev/null | head -c 2000)"
    size=$((size + ${#body}))
    PENDING_ARGS+=(--data-urlencode "pending_change=$(basename "$f" .md)
$body")
  done <<<"$files"
  PENDING_ARGS+=(--data-urlencode "pending_changes_total=$total")
}

# Gzipped pg_dump into backups/, keeping the newest 7 pre-update dumps.
BACKUP_ERROR=""
backup() {
  mkdir -p "$DIR/backups"
  local file user db url
  file="$DIR/backups/pre-update-$(date +%Y%m%d-%H%M%S)-$1.sql.gz"
  if [ "$MODE" = docker ]; then
    user="$(env_get POSTGRES_USER)"
    db="$(env_get POSTGRES_DB)"
    if ! docker compose exec -T db pg_dump -U "${user:-trove}" "${db:-trove}" | gzip >"$file"; then
      rm -f "$file"
      BACKUP_ERROR="pg_dump in the db container failed."
      return 1
    fi
  else
    url="$(env_get DATABASE_URL)"
    if ! command -v pg_dump >/dev/null; then
      BACKUP_ERROR="pg_dump isn't installed on this host (apt install postgresql-client)."
      return 1
    fi
    if ! pg_dump "$url" | gzip >"$file"; then
      rm -f "$file"
      BACKUP_ERROR="pg_dump against DATABASE_URL failed."
      return 1
    fi
  fi
  chmod 600 "$file"
  ls -1t "$DIR"/backups/pre-update-*.sql.gz 2>/dev/null | tail -n +8 | xargs -r rm -f
  log "database backed up to $file"
}

# Bare metal: build a commit into releases/<tag>, beside the running one.
build_release() {
  local commit="$1" tag="$2" rel="$DIR/releases/$2" src="$DIR/.build/$2"
  if [ -f "$rel/.complete" ] && [ "$(sed -n 's/^TROVE_BUILD_COMMIT=//p' "$rel/BUILD_INFO" 2>/dev/null)" = "$commit" ]; then
    log "$tag is already built"
    return 0
  fi
  # Called from an `if`, where set -e does nothing: every step checks itself.
  rm -rf "$rel"
  git worktree remove --force "$src" 2>/dev/null || rm -rf "$src"
  git worktree prune
  mkdir -p "$DIR/.build" "$DIR/releases" || return 1
  git worktree add --force --detach "$src" "$commit" || return 1
  (
    set -e
    cd "$src"
    npm ci --no-audit --no-fund
    # src/lib/env.ts validates at import, which happens during the build.
    # Placeholders only; the real values come from .env at runtime.
    NEXT_TELEMETRY_DISABLED=1 \
      DATABASE_URL=postgres://build:build@localhost:5432/build \
      AUTH_SECRET=build-time-placeholder-value-unused-at-runtime \
      APP_URL=http://localhost:3000 \
      npm run build
  ) || return 1
  mkdir -p "$rel/.next" &&
    cp -a "$src/.next/standalone/." "$rel/" &&
    cp -a "$src/.next/static" "$rel/.next/static" &&
    cp -a "$src/public" "$src/drizzle" "$src/dist" "$rel/" || return 1
  if [ -d "$src/changes" ]; then cp -a "$src/changes" "$rel/" || return 1; fi
  {
    echo "TROVE_BUILD_VERSION=$tag"
    echo "TROVE_BUILD_COMMIT=$commit"
    echo "TROVE_BUILT_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  } >"$rel/BUILD_INFO" || return 1
  touch "$rel/.complete"
  git worktree remove --force "$src" || rm -rf "$src"
  git worktree prune
  return 0
}

# Point `current` at a release in one rename, so the service never sees half.
switch_current() {
  ln -sfn "$1" "$DIR/.current.new"
  mv -T "$DIR/.current.new" "$DIR/current"
}

restart_service() { sudo -n systemctl restart "$SERVICE"; }

deploy() {
  local commit="$1" tag="$2"
  git checkout --quiet --detach "$commit"
  if [ "$MODE" = docker ]; then
    env_set TROVE_IMAGE_TAG "$tag"
    docker compose up -d --remove-orphans
  else
    switch_current "releases/$tag"
    restart_service
  fi
}

# Docker: drop unused images. Bare metal: keep the newest few releases, and
# always the one running.
prune() {
  if [ "$MODE" = docker ]; then
    docker image prune -f >/dev/null 2>&1 || true
    return
  fi
  local keep running
  running="$(basename "$(readlink "$DIR/current")")"
  keep="$(ls -1t "$DIR/releases" 2>/dev/null | head -n "$KEEP_RELEASES")"
  local path r
  for path in "$DIR"/releases/*/; do
    [ -d "$path" ] || continue
    r="$(basename "$path")"
    [ "$r" = "$running" ] && continue
    grep -qx "$r" <<<"$keep" && continue
    rm -rf "${DIR:?}/releases/$r"
  done
}

# Healthy = the app answers the policy endpoint with the expected commit,
# which also proves it reached the database. An empty commit: any answer.
wait_healthy() {
  local want="$1" deadline=$((SECONDS + HEALTH_TIMEOUT)) body
  # Give the old process a moment to go, so it isn't the one answering.
  sleep 5
  while [ "$SECONDS" -lt "$deadline" ]; do
    if body="$(curl -fsS -m 5 -H "Authorization: Bearer $TOKEN" "$URL/api/internal/updates/policy" 2>/dev/null)" &&
      { [ -z "$want" ] || [ "$(policy_get running_commit <<<"$body")" = "$want" ]; }; then
      return 0
    fi
    sleep 5
  done
  return 1
}

main "$@"
exit $?
