/** The single HTML page of the web UI. Styles are inline; the app is /app.js. */
export function pageHtml(title: { version: string; cwd: string }): string {
  const escape = (text: string) =>
    text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>genaicode</title>
<link rel="icon" type="image/png" href="/assets/wolf-64.png">
<style>${STYLES}</style>
</head>
<body>
<div id="root" data-version="${escape(title.version)}" data-cwd="${escape(title.cwd)}"></div>
<script type="module" src="/app.js"></script>
</body>
</html>`;
}

// The page around <AgentChat>: header bar, wolf. The chat's own styles come with the client
// (src/react/agent-chat.css); its defaults match these colors.
const STYLES = `
:root {
  --bg: #f7f7f5; --panel: #ffffff; --text: #1d1d1b; --muted: #6b6b66; --faint: #9a9a94;
  --line: #e4e4df; --accent: #3b5bdb; --ok: #2b8a3e; --err: #c92a2a;
  --shadow: 0 1px 2px rgba(0,0,0,.05), 0 4px 16px rgba(0,0,0,.04);
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --wolf: url(/assets/wolf.webp);
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #141414; --panel: #1d1d1c; --text: #ececea; --muted: #a3a39e; --faint: #74746f;
    --line: #2e2e2c; --accent: #7c9bff; --ok: #69db7c; --err: #ff8787;
    --shadow: 0 1px 2px rgba(0,0,0,.3);
    --wolf: url(/assets/wolf-dark.webp);
    color-scheme: dark;
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body { background: var(--bg); color: var(--text); font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
#root { height: 100%; display: flex; flex-direction: column; }
#root > .gc-chat { flex: 1; height: auto; background: transparent; position: relative; z-index: 1; }
button, input, select, textarea { font: inherit; color: inherit; }
header.bar { display: flex; align-items: center; gap: 12px; padding: 10px 20px; border-bottom: 1px solid var(--line); background: var(--panel); flex-wrap: wrap; position: relative; z-index: 1; }
.brand { font-weight: 700; letter-spacing: -.01em; display: flex; align-items: center; gap: 8px; }
.brand img { width: 24px; height: 24px; image-rendering: pixelated; }
.wolf { width: 180px; height: 180px; margin: 0 auto 12px; background: var(--wolf) center / contain no-repeat; }
#root.has-turns::before { content: ''; position: fixed; inset: 64px 0 120px; background: var(--wolf) center / min(420px, 60vw) no-repeat; opacity: .06; pointer-events: none; z-index: 0; }
button.chip { cursor: pointer; }
button.chip:hover { border-color: var(--accent); }
.brand small { font-weight: 400; color: var(--faint); }
.field { display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 13px; }
.field select, .field input { background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 5px 8px; font-size: 13px; }
.field input { width: 240px; }
.cwd { font-family: var(--mono); font-size: 12px; color: var(--muted); white-space: nowrap; }
.spacer { flex: 1; }
.chip { font-size: 12px; color: var(--muted); background: var(--bg); border: 1px solid var(--line); border-radius: 999px; padding: 3px 10px; white-space: nowrap; }
.conn { width: 8px; height: 8px; border-radius: 50%; background: var(--ok); }
.conn.off { background: var(--err); }
.gc-empty h1 { color: var(--text); font-size: 26px; letter-spacing: -.02em; margin: 0 0 8px; }
.ideas { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; margin-top: 20px; }
.ideas button { background: var(--panel); border: 1px solid var(--line); border-radius: 999px; padding: 7px 14px; cursor: pointer; box-shadow: var(--shadow); }
.ideas button:hover { border-color: var(--accent); }
@media (max-width: 640px) {
  header.bar { padding: 8px 16px; gap: 8px; }
  .cwd { display: none; }
  .field input { width: 120px; }
}
`;
