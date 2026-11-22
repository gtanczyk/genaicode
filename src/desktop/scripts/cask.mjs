#!/usr/bin/env node
// Prints the Homebrew cask of one released version, for the tap gtanczyk/homebrew-genaicode:
//
//   node src/desktop/scripts/cask.mjs --version 3.0.0 --arm64 <sha256 of the arm64 .dmg> --x86_64 <sha256>
//
// The release workflow writes it to Casks/genaicode.rb of the tap, so that
// `brew install --cask gtanczyk/genaicode/genaicode` installs the newest app.
import { parseArgs } from 'node:util';

export function cask({ version, arm64, x86_64 }) {
  if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw new Error(`Not a version: ${version}`);
  for (const [name, sum] of Object.entries({ arm64, x86_64 }))
    if (!/^[0-9a-f]{64}$/.test(sum ?? '')) throw new Error(`--${name} takes the sha256 of that .dmg`);
  return `cask "genaicode" do
  arch arm: "arm64", intel: "x86_64"

  version "${version}"
  sha256 arm:   "${arm64}",
         intel: "${x86_64}"

  url "https://github.com/gtanczyk/genaicode/releases/download/v#{version}/genaicode-#{version}-macos-#{arch}.dmg"
  name "Genaicode"
  desc "Desktop app for the coding agents you already have"
  homepage "https://grzegorz.tanczyk.pl/genaicode/"

  livecheck do
    url :url
    strategy :github_latest
  end

  # The app offers its own updates and installs them when told to.
  auto_updates true
  # Homebrew reads a bare release as "this one or newer". The app itself needs 13.5.
  depends_on macos: :ventura

  app "Genaicode.app"

  zap trash: [
    "~/Library/Application Support/pl.tanczyk.grzegorz.genaicode",
    "~/Library/Caches/pl.tanczyk.grzegorz.genaicode",
    "~/Library/Preferences/pl.tanczyk.grzegorz.genaicode.plist",
    "~/Library/Saved Application State/pl.tanczyk.grzegorz.genaicode.savedState",
    "~/Library/WebKit/pl.tanczyk.grzegorz.genaicode",
  ]
end
`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({
    options: { version: { type: 'string' }, arm64: { type: 'string' }, x86_64: { type: 'string' } },
  });
  process.stdout.write(cask(values));
}
