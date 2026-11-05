#!/usr/bin/env bash
# Installs the Trove KB host updater (a systemd timer) for this checkout.
#
#   sudo updater/install-updater.sh                        # Docker, as the checkout's owner
#   sudo updater/install-updater.sh --user ops             # Docker, as another user
#   sudo updater/install-updater.sh --mode bare-metal      # no Docker: Node + systemd
#
# Docker: the updater runs as that user, which must be in the docker group.
# It never runs as root, and the containers never get Docker access. The
# installer first checks that the image for TROVE_IMAGE_TAG (default: stable)
# can be pulled, and changes nothing if it can't.
#
# Bare metal: installs trove-kb.service (the app, run as that user from
# releases/<version> via the `current` link), a sudoers line that lets that
# user restart it and nothing else, and builds the first release from the
# checkout's commit. Needs Node 22+, npm, git, and pg_dump for the
# pre-update backups.
#
# Both: adds the shared TROVE_UPDATER_TOKEN to .env and enables the timer.
# Re-running is safe: it keeps an existing token.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT_DIR="${TROVE_UNIT_DIR:-/etc/systemd/system}"
SUDOERS_FILE="${TROVE_SUDOERS_FILE:-/etc/sudoers.d/trove-kb-update}"
RUN_USER="$(stat -c %U "$DIR")"
MODE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --user) RUN_USER="${2:?--user needs a name}"; shift 2 ;;
    --mode) MODE="${2:?--mode needs docker or bare-metal}"; shift 2 ;;
    -h | --help) sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

if [ "$(id -u)" != 0 ]; then
  echo "Run with sudo: it installs systemd units." >&2
  exit 1
fi
if [ ! -f "$DIR/.env" ]; then
  echo "No $DIR/.env yet. Copy .env.example and fill it in first (see README -> Updates)." >&2
  exit 1
fi
if [ "$RUN_USER" = root ]; then
  echo "The updater shouldn't run as root. Pass --user <name>, an account that owns $DIR." >&2
  exit 1
fi
id "$RUN_USER" >/dev/null 2>&1 || { echo "No user '$RUN_USER'." >&2; exit 1; }

# Read KEY from .env without sourcing it, as trove-kb-update.sh does.
env_get() {
  sed -n "s/^$1=//p" "$DIR/.env" | tail -n1 | sed -e 's/[[:space:]]#.*$//' -e 's/[[:space:]]*$//' \
    -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}
env_set() {
  if grep -q "^$1=" "$DIR/.env"; then
    sed -i "s|^$1=.*|$1=$2|" "$DIR/.env"
  else
    printf '%s=%s\n' "$1" "$2" >>"$DIR/.env"
  fi
}
# Run as the updater's user from the checkout, so git, npm and docker see the
# same ownership and permissions the timer will.
as_user() { (cd "$DIR" && sudo -u "$RUN_USER" -H env "$@"); }

MODE="${MODE:-$(env_get TROVE_DEPLOY_MODE)}"
MODE="${MODE:-docker}"
case "$MODE" in docker | bare-metal) ;; *)
  echo "--mode must be docker or bare-metal, not '$MODE'." >&2
  exit 1
  ;;
esac

if [ "$(stat -c %U "$DIR")" != "$RUN_USER" ]; then
  echo "$DIR belongs to $(stat -c %U "$DIR"), not $RUN_USER. The updater checks out new versions there," >&2
  echo "so it must own it: sudo chown -R $RUN_USER: $DIR" >&2
  exit 1
fi

install_units() {
  local unit
  for unit in "$@"; do
    sed -e "s|@DIR@|$DIR|g" -e "s|@USER@|$RUN_USER|g" "$DIR/updater/$unit" >"$UNIT_DIR/$unit"
  done
}

add_token() {
  if ! grep -q '^TROVE_UPDATER_TOKEN=.' "$DIR/.env"; then
    sed -i '/^TROVE_UPDATER_TOKEN=/d' "$DIR/.env"
    printf 'TROVE_UPDATER_TOKEN=%s\n' "$(openssl rand -hex 32)" >>"$DIR/.env"
    echo "Added TROVE_UPDATER_TOKEN to .env"
  fi
  env_set TROVE_DEPLOY_MODE "$MODE"
  chown "$RUN_USER": "$DIR/.env"
  chmod 600 "$DIR/.env"
}

if [ "$MODE" = docker ]; then
  if ! id -nG "$RUN_USER" | tr ' ' '\n' | grep -qx docker; then
    echo "User '$RUN_USER' isn't in the docker group. Add it (sudo usermod -aG docker $RUN_USER) or pass --user." >&2
    exit 1
  fi

  # The stack must run the published image before the updater can manage it,
  # so check it first and change nothing if it's missing.
  TAG="$(env_get TROVE_IMAGE_TAG)"
  TAG="${TAG:-stable}"
  echo "Checking the image for TROVE_IMAGE_TAG=$TAG ..."
  if ! as_user TROVE_IMAGE_TAG="$TAG" docker compose pull --quiet app; then
    {
      echo
      echo "The image for '$TAG' can't be pulled, so nothing was changed."
      if [ "$TAG" = stable ]; then
        echo ":stable is published with the first release (a vX.Y.Z tag on main)."
      fi
      commit="$(as_user git rev-parse --short=7 HEAD 2>/dev/null || true)"
      if [ -n "$commit" ] && as_user TROVE_IMAGE_TAG="dev-$commit" docker compose pull --quiet app >/dev/null 2>&1; then
        echo "This checkout's commit has a published image. To run it (Development"
        echo "channel), add this line to $DIR/.env and run the installer again:"
        echo "  TROVE_IMAGE_TAG=dev-$commit"
      else
        echo "Set TROVE_IMAGE_TAG in $DIR/.env to a published build, check out the"
        echo "matching commit, and run the installer again:"
        echo "  TROVE_IMAGE_TAG=v1.2.3       a release (git checkout v1.2.3)"
        echo "  TROVE_IMAGE_TAG=dev-<sha7>   a commit merged to dev (git checkout <sha>)"
      fi
    } >&2
    exit 1
  fi

  add_token
  install_units trove-kb-update.service trove-kb-update.timer
  # Start the stack on the published image; the app picks up the token here.
  as_user docker compose up -d
  echo "Running $TAG."
else
  for tool in git node npm curl flock; do
    command -v "$tool" >/dev/null || { echo "$tool isn't installed." >&2; exit 1; }
  done
  node_major="$(node -p 'process.versions.node.split(".")[0]')"
  if [ "$node_major" -lt 22 ]; then
    echo "Trove KB needs Node 22 or newer; this host has $(node -v)." >&2
    exit 1
  fi
  command -v pg_dump >/dev/null ||
    echo "Warning: pg_dump isn't installed, so updates will refuse to run until it is (apt install postgresql-client)." >&2

  add_token

  # The one privileged thing the updater does: restart the app.
  SYSTEMCTL="$(command -v systemctl)"
  printf '%s ALL=(root) NOPASSWD: %s restart trove-kb.service\n' "$RUN_USER" "$SYSTEMCTL" >"$SUDOERS_FILE.tmp"
  chmod 440 "$SUDOERS_FILE.tmp"
  if ! visudo -cf "$SUDOERS_FILE.tmp" >/dev/null; then
    rm -f "$SUDOERS_FILE.tmp"
    echo "The sudoers line didn't validate; nothing was installed." >&2
    exit 1
  fi
  mv "$SUDOERS_FILE.tmp" "$SUDOERS_FILE"

  install_units trove-kb.service trove-kb-update.service trove-kb-update.timer
  systemctl daemon-reload
  systemctl enable trove-kb.service

  # The first release: this checkout's commit, built beside nothing.
  echo "Building the first release from $(as_user git rev-parse --short HEAD). This takes a few minutes ..."
  if ! as_user "$DIR/updater/trove-kb-update.sh" --install HEAD; then
    echo "The first release didn't come up. See: journalctl -u trove-kb.service" >&2
    exit 1
  fi
fi

systemctl daemon-reload
systemctl enable --now trove-kb-update.timer
echo
echo "Installed ($MODE). Pick a channel in Admin -> System health -> Updates."
echo "Logs: journalctl -u trove-kb-update.service"
systemctl list-timers trove-kb-update.timer --no-pager || true
