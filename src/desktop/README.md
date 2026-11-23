# Genaicode desktop (macOS and Linux)

A native shell around `genaicode ui`, built with [Tauri 2](https://v2.tauri.app). It is not part of
the npm package: each release of genaicode carries the app as downloads of its GitHub Release.

| Download                          | For                                              |
| --------------------------------- | ------------------------------------------------ |
| `Genaicode-macos-arm64.dmg`       | Macs with Apple silicon, macOS 13.5 or newer     |
| `Genaicode-macos-x86_64.dmg`      | Intel Macs                                       |
| `Genaicode-linux-x86_64.AppImage` | Linux, any distribution; this one updates itself |
| `Genaicode-linux-x86_64.deb`      | Debian and Ubuntu                                |

`https://github.com/gtanczyk/genaicode/releases/latest/download/<name>` is always the newest one.
On a Mac, Homebrew installs the same `.dmg`. Homebrew 7 loads casks only from taps you trust, so
trust the tap first:

```sh
brew trust gtanczyk/genaicode
brew install --cask gtanczyk/genaicode/genaicode
```

The app carries its own Node.js and its own copy of genaicode, so it needs neither on the machine:

| In the app                    | What it is                                                                |
| ----------------------------- | ------------------------------------------------------------------------- |
| `Contents/MacOS/genaicode`    | The shell (`src-tauri/src/lib.rs`): window, menu, child process           |
| `Contents/MacOS/node`         | The official Node.js binary, version and checksums in `node-runtime.json` |
| `Contents/Resources/runtime/` | This repository as `npm pack` makes it, with its runtime dependencies     |

Without any agent CLI on the machine the window shows how to get one and goes on to the chat once
one is installed. The app has no project folder: each conversation resolves its own working
directory from context (a continued session's directory or repo root, a topic's most recent active
directory, or `~/.genaicode/home` for cross-project questions), and its chat is about their sessions
in every project. On start the shell reads the environment of your login shell (so the agent CLIs
and the API keys your profile exports are found), removes any legacy saved folder file, runs
`node cli.js ui --sessions --delegate --home --no-open --exit-with-stdin --restore` and shows the
address that prints. `--restore` brings back the conversation the app had last, so a restart or an
update does not lose it. `--sessions` gives the agent the session index as tools, so a question
about what goes on in a project is answered from it and not by searching the disk; in the neutral
home, `open_project` lets the agent offer to move the conversation into a project directory after
your confirmation. The empty chat opens on your topics: those that wait for you, those agents work
on, recent topics, and each agent's plan limits; a topic opens its sessions or starts a new chat in
that topic's directory. The page gets no Tauri commands; it is the page a browser would load.
Quitting the app stops the server.

It also keeps an icon in the menu bar with the sessions of every agent that ask you something now, read from
`node cli.js sessions --waiting --json --watch --exit-with-stdin`: the number beside the icon is
how many. Clicking a session shows the window and opens that session in its directory; a question an agent holds open for an answer
from outside (`genaicode hooks install --answer`) has **Approve** and **Deny**, which run
`sessions approve|deny <question>`. Above them the menu shows how much of each agent's plan is used
(`claude: 5h 62% · 7d 41%`), from the `limits` of the same watch. Once `genaicode topics refresh`
has sorted your sessions, a waiting session is named by its topic instead of its directory, and
below them the menu lists the topics agents work on now (`▶ Pack mode · 2 working`). On macOS closing the window hides it and the app stays in the
menu bar; **Quit** ends it. What the menu shows is decided in `src-tauri/src/tower.rs`.

On Linux the icon sits in the panel's status area (XFCE, KDE, Cinnamon and others show it; GNOME
needs its AppIndicator extension, and without one the app is its window alone). Closing the window
there quits the app. A package installs the shell as `genaicode-desktop`, so the `genaicode` command
stays the command line's, and keeps Node.js inside `/usr/lib/Genaicode/runtime` instead of beside
the shell (`src-tauri/tauri.linux.conf.json`), where it would replace the system's `node`.

## Build it

Needs Rust (stable), Node.js 22+ and, on Linux, the
[Tauri system packages](https://v2.tauri.app/start/prerequisites/) with
`libayatana-appindicator3-dev` for the menu bar icon. From the repository root:

```bash
npm ci
npm run desktop:prepare   # downloads Node.js, packs genaicode into src-tauri/runtime
npm run desktop:dev       # run the shell from source
npm run desktop:build     # Genaicode.app and a .dmg under src-tauri/target/release/bundle;
                          # on Linux an AppImage and a .deb
```

`bash src/desktop/scripts/check-linux.sh src/desktop/src-tauri/target/release/bundle` installs the
`.deb` and starts the app on a virtual screen (needs `xvfb` and `dbus-x11`), as CI does.

Run `desktop:prepare` again after changing genaicode itself. An unsigned local build runs on the
Mac that built it; set `APPLE_SIGNING_IDENTITY=-` for an ad-hoc signature, or a Developer ID
identity for one other Macs accept.

## Release it

`.github/workflows/desktop-release.yaml` builds the app after each npm release and adds the
downloads above to the GitHub Release of that version, each also as `genaicode-<version>-…`. The
macOS apps are signed with the Developer ID certificate and notarized by Apple, which needs five
secrets in the `apple` environment (limit that environment to the default branch, so no other
branch can read them): `APPLE_CERTIFICATE` (the Developer ID Application certificate with its key,
a `.p12` in base64), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` and
`APPLE_API_KEY_P8` (an App Store Connect API key, for the notarization). Without the certificate
the macOS jobs end before they build. The Linux packages are not signed.

The same run writes the Homebrew cask (`scripts/cask.mjs`) to `Casks/genaicode.rb` of
[gtanczyk/homebrew-genaicode](https://github.com/gtanczyk/homebrew-genaicode), once the secret
`HOMEBREW_TAP_TOKEN` holds a token that may write that repository's contents.

## Updates

The app looks for a newer version at start, every half hour while it runs and on **Check for
Updates…** in its menu. It downloads one quietly, saying **Downloading update…** meanwhile, and then offers **Relaunch to update** in the
window's header and in the menu bar (**Relaunching…** once chosen): it never installs unasked, because that restarts the app and
stops the agents it runs. The shell tells the page through the server it started: it writes
`update-downloading <version>`, `update-ready <version>` and `update-installing <version>` to the server's stdin, and the page's button makes the server print
`Relaunch to update` on stderr, which the shell reads. It reads `latest.json` of the newest GitHub Release, which
the release workflow adds with the archive each platform updates from
(`genaicode-<version>-macos-<arch>.app.tar.gz`; on Linux the AppImage itself). On Linux only an
AppImage installs its own update: an app from the `.deb` says that a newer version is out and where
to get it. That archive is signed with a key of its own (`npx tauri signer generate`): its
private half is the secret `TAURI_SIGNING_PRIVATE_KEY` (with `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`)
in the `apple` environment, its public half is `plugins.updater.pubkey` in
`src-tauri/tauri.conf.json`. An app accepts only an update signed with that key, so losing the
private key means a manual download for everyone. Without the secret a release gets the `.dmg` only.

| Variable                 | For development                                         |
| ------------------------ | ------------------------------------------------------- |
| `GENAICODE_DESKTOP_NODE` | Node.js binary to run, instead of the bundled one       |
| `GENAICODE_DESKTOP_CLI`  | `cli.js` to run, e.g. `dist/cli.js` of the working tree |

The app needs macOS 13.5 or newer, the oldest the bundled Node.js 24 supports. To move to a newer
Node.js, change `version` in `node-runtime.json`, copy the four checksums from
`https://nodejs.org/dist/v<version>/SHASUMS256.txt` and check `minimumSystemVersion` in
`tauri.conf.json` against that release's macOS target.
