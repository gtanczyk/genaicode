// Move ?token= out of the address bar into origin-isolated sessionStorage before first paint.
// Skips framed loads (dev overlays keep the token in the iframe URL).
const STRIP_TOKEN_SCRIPT = `<script>(()=>{const u=new URL(location.href),t=u.searchParams.get('token');if(!t||window.self!==window.top)return;try{sessionStorage.setItem('genaicode-token',t)}catch{window.__genaicodeToken=t}u.searchParams.delete('token');history.replaceState(null,'',u.pathname+u.search+u.hash)})()</script>`;

/** The single HTML page of the web UI. Styles are inline; the app is /app.js. */
export function pageHtml(title: { version: string; cwd: string; sessions?: boolean; stripToken?: boolean }): string {
  const escape = (text: string) =>
    text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>genaicode</title>
<link rel="icon" type="image/png" href="/assets/wolf-64.png">${title.stripToken ? `\n${STRIP_TOKEN_SCRIPT}` : ''}
<style>${STYLES}</style>
</head>
<body>
<div id="root" data-version="${escape(title.version)}" data-cwd="${escape(title.cwd)}"${title.sessions ? ' data-sessions="1"' : ''}></div>
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
.chip[data-level='warning'] { color: #e8590c; border-color: currentColor; }
.chip[data-level='exceeded'] { color: var(--err); border-color: currentColor; }
.chip.waits { color: var(--accent); border-color: currentColor; }
.chip.waits.on { color: var(--bg); background: var(--accent); }
.conn { width: 8px; height: 8px; border-radius: 50%; background: var(--ok); }
.conn.off { background: var(--err); }
.gc-empty h1 { color: var(--text); font-size: 26px; letter-spacing: -.02em; margin: 0 0 8px; }
.ideas { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; margin-top: 20px; }
.ideas button { background: var(--panel); border: 1px solid var(--line); border-radius: 999px; padding: 7px 14px; cursor: pointer; box-shadow: var(--shadow); }
.ideas button:hover { border-color: var(--accent); }
.sessions { flex: 1; overflow: auto; padding: 16px 20px 40px; position: relative; z-index: 1; }
.sessions .tools { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 12px; }
.sessions .tools input[type='search'] { flex: 1; min-width: 180px; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 6px 10px; }
.sessions .tools select { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 6px 8px; font-size: 13px; }
.sessions .count { color: var(--muted); font-size: 13px; }
.sessions .errors { color: var(--err); font-size: 13px; margin-bottom: 8px; }
.tower-inbox { width: 100%; max-width: 880px; margin: 0 auto; }
.tower-inbox h1 { font-size: 24px; }
.tower-inbox h2 { margin: 0 0 5px; font-size: 16px; }
.tower-inbox article { padding: 14px 16px; overflow-wrap: anywhere; }
.tower-inbox .recipient { color: var(--muted); font: 13px/1.5 var(--mono); }
.tower-inbox pre { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 32vh; overflow: auto; background: var(--bg); padding: 8px 12px; border-radius: 6px; }
.tower-inbox .act { display: flex; gap: 8px; }
.tower-inbox button { padding: 4px 12px; color: var(--text); background: var(--bg); border: 1px solid var(--line); border-radius: 6px; cursor: pointer; }
.tower-inbox button:first-child { background: var(--accent); color: var(--bg); }
.tower-inbox [role=status]:empty { display: none; }
.project { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; margin-bottom: 10px; box-shadow: var(--shadow); }
.project > summary { cursor: pointer; padding: 8px 12px; display: flex; gap: 10px; align-items: baseline; list-style: none; }
.project > summary::-webkit-details-marker { display: none; }
.project > summary b { font-weight: 600; }
.project > summary .path { font-family: var(--mono); font-size: 12px; color: var(--faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.project > summary .counts { font-size: 12px; color: var(--muted); white-space: nowrap; }
.session-row { display: grid; grid-template-columns: 16px 92px 40px 1fr auto; gap: 8px; align-items: baseline; padding: 5px 12px; border-top: 1px solid var(--line); font-size: 13px; }
.session-row .mark[data-state='active'] { color: var(--ok); }
.session-row .mark[data-state='unfinished'] { color: #e8590c; }
.session-row .mark[data-state='approval'] { color: #e03131; }
.session-row .label small.asks { color: #e03131; font-weight: 600; }
.session-row .agent, .session-row .age { color: var(--muted); white-space: nowrap; }
.session-row .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.session-row .act { display: flex; gap: 6px; }
.session-row .label small { color: var(--faint); margin-left: 8px; }
.session-row button, .session-row a { font-size: 12px; background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 1px 8px; cursor: pointer; color: var(--muted); text-decoration: none; white-space: nowrap; }
.session-row button:hover, .session-row a:hover { border-color: var(--accent); color: var(--text); }
.question-row { display: flex; gap: 8px; align-items: center; justify-content: space-between; padding: 3px 12px 6px 36px; font-size: 12px; }
.question-row .what { display: flex; gap: 8px; align-items: baseline; min-width: 0; color: #e03131; }
.question-row code { color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.command-preview code { white-space: pre-wrap; overflow-wrap: anywhere; }
.question-row .act { display: flex; gap: 6px; }
.question-row button { font-size: 12px; background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 1px 10px; cursor: pointer; color: var(--muted); }
.question-row button.allow { color: var(--bg); background: var(--accent); border-color: var(--accent); }
.question-row button:disabled { opacity: 0.5; cursor: default; }
.session-reply { display: grid; gap: 6px; padding: 4px 12px 10px 36px; font-size: 13px; }
.session-reply textarea { width: 100%; min-height: 3em; resize: vertical; box-sizing: border-box; }
.session-reply > div { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.session-reply label { margin-right: auto; color: var(--muted); }
.session-reply :is(textarea, select, button) { font: inherit; border: 1px solid var(--line); background: var(--bg); color: var(--text); border-radius: 6px; padding: 4px 8px; }
.session-reply button[type=submit] { color: var(--bg); background: var(--accent); }
.session-reply button:disabled { opacity: .55; }
.session-receipt { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; margin-bottom: 10px; padding: 8px 12px; font-size: 13px; }
.session-receipt p { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 14em; overflow: auto; margin: 4px 0; }
.more { padding: 6px 12px; border-top: 1px solid var(--line); }
.more button { background: none; border: 0; color: var(--accent); cursor: pointer; font-size: 13px; padding: 0; }
@media (max-width: 640px) {
  .session-row { grid-template-columns: 16px 70px 34px 1fr; }
  .session-row .act { grid-column: 2 / -1; flex-wrap: wrap; }
  header.bar { padding: 8px 16px; gap: 8px; }
  .cwd { display: none; }
  .field input { width: 120px; }
}
`;
