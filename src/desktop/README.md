# genaicode desktop (macOS, in the making)

A native shell around `genaicode ui`, built with [Tauri 2](https://v2.tauri.app). It is not part of
the npm package and has no release yet.

The app carries its own Node.js and its own copy of genaicode, so it needs neither on the machine:

| In the app                    | What it is                                                                |
| ----------------------------- | ------------------------------------------------------------------------- |
| `Contents/MacOS/genaicode`    | The shell (`src-tauri/src/lib.rs`): window, menu, child process           |
| `Contents/MacOS/node`         | The official Node.js binary, version and checksums in `node-runtime.json` |
| `Contents/Resources/runtime/` | This repository as `npm pack` makes it, with its runtime dependencies     |

On start the shell asks for a project folder (remembered for next time, **Project → Open Folder…**
changes it), reads the environment of your login shell (so the agent CLIs and the API keys your profile exports are found), runs
`node cli.js ui --sessions --no-open --exit-with-stdin --cwd <folder>` and shows the address that prints. `--sessions` gives the agent the session index as tools, so a question about what goes on in a project is answered from it and not by searching the disk. The
empty chat opens on your topics: those that wait for you, those agents work on, and each agent's plan limits; a topic opens its sessions. The
page gets no Tauri commands; it is the page a browser would load. Quitting the app stops the server.

It also keeps an icon in the menu bar with the sessions of every agent that ask you something now, read from
`node cli.js sessions --waiting --json --watch --exit-with-stdin`: the number beside the icon is
how many. A session opens its project in the window; a question an agent holds open for an answer
from outside (`genaicode hooks install --answer`) has **Approve** and **Deny**, which run
`sessions approve|deny <question>`. Above them the menu shows how much of each agent's plan is used
(`claude: 5h 62% · 7d 41%`), from the `limits` of the same watch. Once `genaicode topics refresh`
has sorted your sessions, a waiting session is named by its topic instead of its directory, and
below them the menu lists the topics agents work on now (`▶ Pack mode · 2 working`). On macOS closing the window hides it and the app stays in the
menu bar; **Quit** ends it. What the menu shows is decided in `src-tauri/src/tower.rs`.

## Build it

Needs Rust (stable), Node.js 22+ and, on Linux, the
[Tauri system packages](https://v2.tauri.app/start/prerequisites/) with
`libayatana-appindicator3-dev` for the menu bar icon. From the repository root:

```bash
npm ci
npm run desktop:prepare   # downloads Node.js, packs genaicode into src-tauri/runtime
npm run desktop:dev       # run the shell from source
npm run desktop:build     # genaicode.app and a .dmg under src-tauri/target/release/bundle
```

Run `desktop:prepare` again after changing genaicode itself. An unsigned local build runs on the
Mac that built it; set `APPLE_SIGNING_IDENTITY=-` for an ad-hoc signature, or a Developer ID
identity for one other Macs accept.

## Release it

`.github/workflows/desktop-release.yaml` builds the app after each npm release, signs it with the
Developer ID certificate, has Apple notarize it and adds `genaicode-<version>-macos-arm64.dmg` to
the GitHub Release of that version. It needs five repository secrets: `APPLE_CERTIFICATE` (the
Developer ID Application certificate with its key, a `.p12` in base64), `APPLE_CERTIFICATE_PASSWORD`,
`APPLE_API_KEY_ID`, `APPLE_API_ISSUER` and `APPLE_API_KEY_P8` (an App Store Connect API key, for the
notarization). Without the certificate the run ends before it builds.

| Variable                 | For development                                         |
| ------------------------ | ------------------------------------------------------- |
| `GENAICODE_DESKTOP_CWD`  | Project folder to open, instead of the remembered one   |
| `GENAICODE_DESKTOP_NODE` | Node.js binary to run, instead of the bundled one       |
| `GENAICODE_DESKTOP_CLI`  | `cli.js` to run, e.g. `dist/cli.js` of the working tree |

The app needs macOS 13.5 or newer, the oldest the bundled Node.js 24 supports. To move to a newer
Node.js, change `version` in `node-runtime.json`, copy the four checksums from
`https://nodejs.org/dist/v<version>/SHASUMS256.txt` and check `minimumSystemVersion` in
`tauri.conf.json` against that release's macOS target.
