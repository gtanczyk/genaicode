# Terms, responsibility and network use

GenAIcode is free and open source under the [Apache License 2.0](../LICENSE). The license
covers the npm package, the command line and the desktop app. There is no separate end-user
agreement to accept. As the license says (sections 7 and 8), the software comes "as is",
without warranties, and the authors are not liable for damage from using it.

## Your agents, your accounts

GenAIcode runs coding agents you install and log in to yourself: Claude Code, Codex, Gemini
CLI, Copilot CLI, Cursor, Antigravity, opencode, Muse, Mistral Vibe and others. The same goes
for the managed and cloud drivers, which use your own API keys, and for the LLM providers in
`genaicode/providers`.

- Each agent keeps its own login, billing, limits and sandbox. GenAIcode does not resell,
  proxy or meter them.
- Your use of an agent or model is governed by that provider's terms and usage policies, not by
  GenAIcode. Check that what you do with it, including running several agents at once or driving
  them from scripts, fits those terms and your plan.
- Prompts, code and files go to the provider of the agent you run, as they would if you ran that
  agent yourself.

## Approvals and YOLO

Agents edit files and run commands. In **Ask** mode GenAIcode passes their approval requests
to you. **Auto-approve**, **YOLO** (`permissions: 'yolo'`), `--dangerously-*` flags of the
agents and `sessions approve` let commands run without a question. Turn them on only where a
mistaken command can do no harm you can't undo, such as a container, a throwaway clone or a
branch under version control. What an agent does in these modes is your responsibility.

Pack mode, `sessions send` and the control tower let one agent hand work or messages to
another. Review the changes before you merge them.

## What GenAIcode sends over the network

GenAIcode has no telemetry, analytics or crash reporting, and no account of its own. Besides
the traffic of the agents and providers you run, it makes these requests:

| When                                                               | Request                                                                                                       | Turn it off                                                   |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Desktop app: at start, every 30 minutes, **Check for Updates…**    | `latest.json` of the newest [GitHub Release](https://github.com/gtanczyk/genaicode/releases), then the update | It never installs without your click                          |
| `genaicode` installed with `genaicode install`: at most once a day | the newest version from `registry.npmjs.org`, then `npm install` of it                                        | `genaicode update --auto off` or `GENAICODE_NO_AUTO_UPDATE=1` |
| `npx genaicode`, `npm install genaicode`                           | npm downloads the package                                                                                     | Pin a version                                                 |
| `sessions --cloud`                                                 | GitHub through your `gh`, `codex cloud list`, your cloud agents' APIs                                         | Leave out `--cloud`                                           |
| An artifact you open, only with `--artifact-cdn` or the CDN switch | scripts, styles and fonts from the CDN hosts you allowed                                                      | Off by default                                                |

The browser UI (`genaicode ui`) listens only on `127.0.0.1`, with a token per run; the dev
overlays run inside your own dev server. Help links in the app open GitHub in your browser.
Handoff transcripts, session indexes and caches stay on your disk under `~/.genaicode` and
`.genaicode/`.

## Third-party software

The desktop app bundles Node.js and Tauri, under their own open source licenses. npm
dependencies keep their licenses, listed in each package. Agent CLIs are not bundled.
