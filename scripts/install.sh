#!/bin/sh
# genaicode installer: puts a `genaicode` command on your PATH that updates itself.
#
#   curl -fsSL https://raw.githubusercontent.com/gtanczyk/genaicode/master/scripts/install.sh | sh
#
# Review this file; it is the whole install. It runs `npm install` of the published genaicode
# package (no lifecycle scripts) into ~/.genaicode/versions/<version>, then that version links
# ~/.genaicode/current and writes the ~/.local/bin/genaicode shim. Nothing needs sudo.
#
#   GENAICODE_VERSION   version or dist-tag to install (default: latest)
#   GENAICODE_HOME      where versions live (default: ~/.genaicode)
#   GENAICODE_BIN_DIR   where the command goes (default: ~/.local/bin)
#   GENAICODE_PACKAGE   npm spec to install instead, e.g. a local tarball (for testing)
#   GENAICODE_FORCE=1   replace a `genaicode` in the bin dir that this installer did not write
set -eu

VERSION="${GENAICODE_VERSION:-latest}"
HOME_DIR="${GENAICODE_HOME:-$HOME/.genaicode}"
BIN_DIR="${GENAICODE_BIN_DIR:-$HOME/.local/bin}"
SPEC="${GENAICODE_PACKAGE:-genaicode@$VERSION}"

fail() {
  echo "genaicode install: $*" >&2
  exit 1
}

command -v node >/dev/null 2>&1 || fail "needs Node.js 20 or newer (https://nodejs.org)"
command -v npm >/dev/null 2>&1 || fail "needs npm (it comes with Node.js)"
major=$(node -p "process.versions.node.split('.')[0]")
[ "$major" -ge 20 ] || fail "Node.js $(node -v) is too old; genaicode needs 20 or newer"

mkdir -p "$HOME_DIR/versions"
staging="$HOME_DIR/versions/.staging-install-$$"
trap 'rm -rf "$staging"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
rm -rf "$staging"
mkdir -p "$staging"

echo "Installing $SPEC into $HOME_DIR"
npm install --prefix "$staging" --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error --update-notifier=false "$SPEC" \
  || fail "npm install $SPEC failed"

pkg="$staging/node_modules/genaicode"
[ -f "$pkg/dist/cli.js" ] || fail "npm did not install genaicode"
installed=$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).version" "$pkg/package.json")

target="$HOME_DIR/versions/$installed"
if [ -f "$target/node_modules/genaicode/dist/cli.js" ]; then
  # Already there, maybe in use by a running session: keep it, drop the fresh copy.
  echo "genaicode $installed is already installed; relinking it"
else
  rm -rf "$target"
  mv "$staging" "$target"
fi

force=""
case "${GENAICODE_FORCE:-}" in
  "" | 0 | false | no) ;;
  *) force="--force" ;;
esac
# shellcheck disable=SC2086
node "$target/node_modules/genaicode/dist/cli.js" self-install --bin-dir "$BIN_DIR" $force

found=$(command -v genaicode 2>/dev/null || true)
if [ -n "$found" ] && [ "$found" != "$BIN_DIR/genaicode" ]; then
  echo "Note: \"genaicode\" on your PATH is $found, which comes before $BIN_DIR."
  echo "Remove it (npm uninstall -g genaicode) or put $BIN_DIR first on PATH."
fi
echo "Run \"genaicode\" to start. It checks for updates once a day; \"genaicode update --auto off\" turns that off."
