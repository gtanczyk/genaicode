#!/usr/bin/env bash
# Checks the Linux packages of the desktop app: what the .deb installs, and that the installed app
# starts on a virtual screen and runs its server.
#
#   bash src/desktop/scripts/check-linux.sh <bundle directory>
set -euo pipefail

bundle="$1"
deb="$(ls "$bundle"/deb/*.deb | head -1)"
appimage="$(ls "$bundle"/appimage/*.AppImage | head -1)"
ls -lh "$deb" "$appimage"

# A package must not carry a `node` or a `genaicode` of its own into /usr/bin: the first would
# replace the system's Node.js, the second is the name of the command line.
files="$(dpkg -c "$deb" | awk '{print $6}' | sed 's|^\./||')"
for taken in usr/bin/node usr/bin/genaicode; do
  if grep -qx "$taken" <<<"$files"; then
    echo "::error::The .deb installs /$taken."
    exit 1
  fi
done
grep -qx usr/bin/genaicode-desktop <<<"$files"

sudo apt-get install -y "$(realpath "$deb")"
node=/usr/lib/Genaicode/runtime/bin/node
"$node" --version
"$node" /usr/lib/Genaicode/runtime/node_modules/genaicode/dist/cli.js --version

project="$(mktemp -d)"
home="$(mktemp -d)"
log="$home/app.log"
HOME="$home" GENAICODE_DESKTOP_CWD="$project" WEBKIT_DISABLE_COMPOSITING_MODE=1 \
  xvfb-run -a dbus-run-session -- genaicode-desktop >"$log" 2>&1 &
app=$!
started=false
for _ in $(seq 1 30); do
  if pgrep -f "$node .*cli.js ui " >/dev/null; then
    started=true
    break
  fi
  sleep 1
done
pkill -f '^genaicode-desktop$' || true
wait "$app" 2>/dev/null || true
if [ "$started" != true ]; then
  cat "$log"
  echo "::error::The installed app did not start its server."
  exit 1
fi
# Quitting the app takes its server with it.
for _ in $(seq 1 10); do
  pgrep -f "$node .*cli.js ui " >/dev/null || break
  sleep 1
done
if pgrep -f "$node .*cli.js ui " >/dev/null; then
  echo "::error::The server outlived the app."
  exit 1
fi
echo "The app starts and stops with its server."
