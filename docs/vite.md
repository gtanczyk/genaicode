# Dev overlay (`genaicode/vite`, `createDevOverlay`)

[← README](../README.md)

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import genaicode from 'genaicode/vite';

export default defineConfig({ plugins: [genaicode()] });
```

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="media/screenshots/vite-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="media/screenshots/vite-light.png">
    <img alt="The genaicode panel over a Vite app: the agent fixed the page's two errors." src="media/screenshots/vite-light.png" width="80%">
  </picture>
</p>

In `vite dev`, the app gets the wolf in its corner. It opens the same chat as `genaicode ui`
in a panel, with the agent working in the project root. The wolf counts the page's errors
(build errors, uncaught exceptions, unhandled rejections, `console.error`), and "Fix N
errors" sends them to the agent as one prompt. Options: `agent`, `model`, `effort`,
`approveAll`, `agents`, `port`, and `captureErrors: false` to leave the page's errors alone.
Builds are untouched. The chat runs on its own port on 127.0.0.1 even when Vite runs with
`--host`, lets only the app's origins frame it, and hands its token (and takes "fix" requests)
only from the app's own pages on this machine.

Any other Node dev server (Express, webpack-dev-server, a script that serves static files)
gets the same overlay from `createDevOverlay` in `genaicode/ui`:

```ts
import { createDevOverlay } from 'genaicode/ui';

const overlay = createDevOverlay(); // same options as the plugin, plus `cwd`
app.use(overlay.middleware); // Express; or `if (await overlay.handle(req, res)) return;`
// ...and in the HTML it serves: overlay.injectHtml(html), or the overlay.script tag.
```

Development only. The token goes only to pages opened at `localhost`, `*.localhost`,
`127.0.0.1` or `[::1]`, and without an agent CLI the overlay stays off.
