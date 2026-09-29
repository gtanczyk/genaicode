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

const STYLES = `
:root {
  --bg: #f7f7f5; --panel: #ffffff; --text: #1d1d1b; --muted: #6b6b66; --faint: #9a9a94;
  --line: #e4e4df; --accent: #3b5bdb; --accent-soft: #e8edff; --accent-text: #ffffff;
  --ok: #2b8a3e; --warn: #b35c00; --warn-soft: #fff4e6; --err: #c92a2a; --err-soft: #fff0f0;
  --code-bg: #f1f1ee; --shadow: 0 1px 2px rgba(0,0,0,.05), 0 4px 16px rgba(0,0,0,.04);
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --wolf: url(/assets/wolf.webp);
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #141414; --panel: #1d1d1c; --text: #ececea; --muted: #a3a39e; --faint: #74746f;
    --line: #2e2e2c; --accent: #7c9bff; --accent-soft: #1f2744; --accent-text: #0e1322;
    --ok: #69db7c; --warn: #ffb35c; --warn-soft: #2e2415; --err: #ff8787; --err-soft: #331b1b;
    --code-bg: #262625; --shadow: 0 1px 2px rgba(0,0,0,.3);
    --wolf: url(/assets/wolf-dark.webp);
    color-scheme: dark;
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body { background: var(--bg); color: var(--text); font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
#root { height: 100%; display: flex; flex-direction: column; }
button, input, select, textarea { font: inherit; color: inherit; }
header.bar { display: flex; align-items: center; gap: 12px; padding: 10px 20px; border-bottom: 1px solid var(--line); background: var(--panel); flex-wrap: wrap; }
.brand { font-weight: 700; letter-spacing: -.01em; display: flex; align-items: center; gap: 8px; }
.brand img { width: 24px; height: 24px; image-rendering: pixelated; }
.wolf { width: 180px; height: 180px; margin: 0 auto 12px; background: var(--wolf) center / contain no-repeat; }
#root.has-turns::before { content: ''; position: fixed; inset: 64px 0 120px; background: var(--wolf) center / min(420px, 60vw) no-repeat; opacity: .06; pointer-events: none; z-index: 0; }
main, header.bar, footer.composer { position: relative; z-index: 1; }
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
main { flex: 1; overflow-y: auto; }
.thread { max-width: 860px; margin: 0 auto; padding: 28px 20px 12px; display: flex; flex-direction: column; gap: 22px; }
.empty { text-align: center; margin-top: 8vh; color: var(--muted); }
.empty h1 { color: var(--text); font-size: 26px; letter-spacing: -.02em; margin: 0 0 8px; }
.ideas { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; margin-top: 20px; }
.ideas button { background: var(--panel); border: 1px solid var(--line); border-radius: 999px; padding: 7px 14px; cursor: pointer; box-shadow: var(--shadow); }
.ideas button:hover { border-color: var(--accent); }
.turn { display: flex; flex-direction: column; gap: 10px; }
.prompt { align-self: flex-end; max-width: 80%; background: var(--accent); color: var(--accent-text); padding: 10px 14px; border-radius: 16px 16px 4px 16px; white-space: pre-wrap; word-wrap: break-word; }
.prompt.steer { background: var(--accent-soft); color: var(--text); font-size: 14px; }
.prompt.steer small { display: block; color: var(--muted); font-size: 11px; }
.agent-row { display: flex; gap: 10px; align-items: flex-start; }
.avatar { flex: none; width: 28px; height: 28px; border-radius: 8px; background: var(--panel); border: 1px solid var(--line); display: grid; place-items: center; font-size: 12px; font-weight: 700; color: var(--accent); text-transform: uppercase; }
.steps { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.md p { margin: 0 0 8px; } .md p:last-child { margin-bottom: 0; }
.md h1, .md h2, .md h3, .md h4 { font-size: 15px; margin: 12px 0 6px; }
.md ul, .md ol { margin: 0 0 8px; padding-left: 22px; }
.md code { font-family: var(--mono); font-size: 13px; background: var(--code-bg); padding: 1px 5px; border-radius: 5px; }
.md pre { background: var(--code-bg); padding: 12px 14px; border-radius: 10px; overflow-x: auto; margin: 0 0 8px; }
.md pre code { background: none; padding: 0; }
.md a { color: var(--accent); }
.caret::after { content: "▍"; color: var(--accent); animation: blink 1s steps(2) infinite; }
@keyframes blink { 50% { opacity: 0; } }
details.tool { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; box-shadow: var(--shadow); }
details.tool summary { list-style: none; cursor: pointer; display: flex; align-items: center; gap: 8px; padding: 7px 12px; font-size: 13px; }
details.tool summary::-webkit-details-marker { display: none; }
details.tool .name { font-weight: 600; }
details.tool .arg { font-family: var(--mono); font-size: 12px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
details.tool pre { margin: 0; padding: 10px 12px; border-top: 1px solid var(--line); font: 12px/1.5 var(--mono); max-height: 320px; overflow: auto; white-space: pre-wrap; color: var(--muted); }
.state { width: 16px; text-align: center; flex: none; }
.state.ok { color: var(--ok); } .state.err { color: var(--err); }
.spin { display: inline-block; width: 12px; height: 12px; border: 2px solid var(--line); border-top-color: var(--accent); border-radius: 50%; animation: spin .8s linear infinite; vertical-align: -2px; }
@keyframes spin { to { transform: rotate(360deg); } }
.files { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; font-size: 13px; color: var(--muted); }
.files code { font-family: var(--mono); font-size: 12px; background: var(--accent-soft); color: var(--text); padding: 2px 8px; border-radius: 6px; }
.approval { border: 1px solid var(--warn); background: var(--warn-soft); border-radius: 12px; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
.approval .what { font-family: var(--mono); font-size: 13px; }
.approval .buttons { display: flex; gap: 8px; }
.approval.done { opacity: .75; flex-direction: row; align-items: center; padding: 8px 12px; font-size: 13px; }
.btn { border: 1px solid var(--line); background: var(--panel); border-radius: 8px; padding: 6px 14px; cursor: pointer; font-weight: 500; }
.btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-text); }
.btn.danger { color: var(--err); }
.btn:disabled { opacity: .5; cursor: default; }
.error { background: var(--err-soft); color: var(--err); border-radius: 10px; padding: 8px 12px; font-size: 13px; white-space: pre-wrap; }
.footer { font-size: 12px; color: var(--faint); padding-left: 38px; }
.footer.bad { color: var(--err); }
.notice { align-self: center; font-size: 13px; color: var(--muted); background: var(--panel); border: 1px dashed var(--line); border-radius: 10px; padding: 8px 14px; white-space: pre-wrap; font-family: var(--mono); }
.notice.err { color: var(--err); }
.working { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--muted); padding-left: 38px; }
footer.composer { border-top: 1px solid var(--line); background: var(--panel); padding: 12px 20px 14px; }
.composer-inner { max-width: 860px; margin: 0 auto; }
.queued { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
.queued span { font-size: 12px; background: var(--bg); border: 1px dashed var(--line); border-radius: 8px; padding: 3px 8px; color: var(--muted); }
.box { display: flex; gap: 8px; align-items: flex-end; background: var(--bg); border: 1px solid var(--line); border-radius: 14px; padding: 8px 8px 8px 14px; }
.box:focus-within { border-color: var(--accent); }
.box textarea { flex: 1; border: 0; background: transparent; resize: none; outline: none; max-height: 200px; padding: 6px 0; }
.hint { font-size: 12px; color: var(--faint); margin-top: 6px; display: flex; gap: 12px; }
@media (max-width: 640px) {
  header.bar { padding: 8px 16px; gap: 8px; }
  .cwd { display: none; }
  .thread { padding: 18px 16px 8px; }
  footer.composer { padding: 10px 16px 12px; }
  .prompt { max-width: 92%; }
  .field input { width: 120px; }
}
`;
