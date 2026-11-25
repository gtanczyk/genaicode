// Move ?token= out of the address bar into origin-isolated sessionStorage before first paint.
// Skips framed loads (dev overlays keep the token in the iframe URL).
const STRIP_TOKEN_SCRIPT = `<script>(()=>{const u=new URL(location.href),t=u.searchParams.get('token');if(!t||window.self!==window.top)return;try{sessionStorage.setItem('genaicode-token',t)}catch{window.__genaicodeToken=t}u.searchParams.delete('token');history.replaceState(null,'',u.pathname+u.search+u.hash)})()</script>`;

/** The single HTML page of the web UI. Styles are inline; the app is /app.js. */
export function pageHtml(title: {
  version: string;
  cwd: string;
  project?: boolean;
  home?: boolean;
  sessions?: boolean;
  stripToken?: boolean;
}): string {
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
<div id="root" data-version="${escape(title.version)}" data-cwd="${escape(title.cwd)}"${title.project === false ? ' data-no-project="1"' : ''}${title.home ? ' data-home="1"' : ''}${title.sessions ? ' data-sessions="1"' : ''}></div>
<script type="module" src="/app.js"></script>
</body>
</html>`;
}

// The page around <AgentChat>: the window's sidebar and top bar, the pages, the wolf. The chat's own styles come with the client
// (src/react/agent-chat.css); its defaults match these colors.
const STYLES = `
.project-team { color: var(--text); background: var(--panel); border: 1px solid var(--line); border-radius: 12px; width: min(26rem, 86vw); max-height: 85vh; padding: 20px; box-shadow: var(--shadow); font: inherit; }
.project-team::backdrop { background: rgba(0,0,0,.38); }
.project-team header, .pack-folder { display: flex; align-items: center; gap: .6rem; }
.project-team header { justify-content: space-between; }
.project-team h2 { margin: 0; font-size: 1.12rem; }
.project-team form { margin-top: 1rem; }
.project-team button, .project-team select, .pack-folder input { font: inherit; color: inherit; background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: .4rem .65rem; }
.project-team button { cursor: pointer; }
.project-team button:disabled { opacity: .55; cursor: default; }
.pack-folder input { flex: 1; min-width: 0; }
.project-team label, .project-team legend { display: block; margin: .45rem 0; }
.project-team fieldset { border: 0; margin: .6rem 0 1rem; padding: 0; }
.project-team fieldset label { display: inline-flex; align-items: center; gap: .2rem; margin: 0 .8rem .4rem 0; }
.project-team .pack-save { background: var(--accent); color: white; }
.project-team .pack-dir { color: var(--muted); overflow-wrap: anywhere; font-family: var(--mono); font-size: .83em; }
.project-team [role=alert] { color: var(--err); }

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
.workspace { flex: 1; min-height: 0; display: flex; position: relative; z-index: 1; overflow: hidden; }
.workspace > .gc-chat { flex: 1; min-width: 0; height: auto; background: transparent; position: relative; z-index: 1; }
button, input, select, textarea { font: inherit; color: inherit; }
/* The window's shell (docs/design/desktop-layout.md). State hues, the sidebar and sunken surfaces and the strong line are the design tokens agent-chat.css sets on :root (--gc-color-*). */
.shell { --side-cur: 268px; flex: 1; min-height: 0; display: grid; grid-template-columns: var(--side-cur) minmax(0, 1fr); }
.shell.side-collapsed { --side-cur: 56px; }
.center { display: flex; flex-direction: column; min-width: 0; min-height: 0; position: relative; }
.grow { flex: 1; min-width: 0; }
svg.i { width: 16px; height: 16px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.sg { width: 12px; height: 12px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; color: var(--muted); }
.sg.run { color: var(--gc-color-run); animation: sg-spin 1.4s linear infinite; }
.sg.ask { color: var(--gc-color-warn); }
.sg.err { color: var(--gc-color-err); }
.sg.ok { color: var(--gc-color-ok); }
@keyframes sg-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .sg.run { animation: none; } }
.btn { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 11px; border-radius: 8px; border: 1px solid var(--gc-color-line-strong); background: var(--panel); font-size: 13px; font-weight: 500; white-space: nowrap; cursor: pointer; }
.btn:hover { background: var(--gc-color-sunken); }
.btn.ghost { border-color: transparent; background: transparent; color: var(--muted); }
.btn.ghost:hover, .btn.ghost[aria-expanded='true'] { background: var(--gc-color-sunken); color: var(--text); }
.btn.sm { height: 26px; padding: 0 8px; font-size: 12px; }
.btn.icon { width: 30px; padding: 0; justify-content: center; }
.btn.sm.icon { width: 26px; }
.btn.ghost.icon.sm { font-size: 16px; }
.btn[aria-pressed='true'] { background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--accent); }
.btn:focus-visible, .nav:focus-visible, .proj > summary:focus-visible, .quota:focus-visible, .update:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.count { min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; font-size: 11px; font-weight: 600; display: inline-grid; place-items: center; background: var(--gc-color-sunken); color: var(--muted); }
.count.hot { background: var(--gc-color-warn); color: var(--bg); }
.pill { display: inline-flex; align-items: center; height: 20px; padding: 0 7px; border-radius: 10px; font-size: 12px; font-weight: 600; background: var(--gc-color-sunken); color: var(--muted); white-space: nowrap; }
.side { background: var(--gc-color-side); border-right: 1px solid var(--line); display: flex; flex-direction: column; min-height: 0; min-width: 0; position: relative; z-index: 31; }
.side-top { display: flex; align-items: center; gap: 8px; height: 46px; padding: 0 10px 0 14px; flex: none; }
.mac-app .side-top, .mac-app .topbar { user-select: none; -webkit-user-select: none; cursor: default; }
.mac-app .side-top { padding-left: 78px; }
.brand { font-weight: 650; letter-spacing: -.01em; display: flex; align-items: center; gap: 7px; font-size: 14px; white-space: nowrap; }
.brand img { width: 20px; height: 20px; image-rendering: pixelated; }
.side-actions { padding: 4px 10px 8px; display: grid; gap: 2px; flex: none; }
.nav { display: flex; align-items: center; gap: 9px; width: 100%; height: 32px; padding: 0 9px; border: 0; background: transparent; border-radius: 8px; text-align: left; font-size: 13px; color: var(--text); cursor: pointer; position: relative; }
.nav:hover, .nav[aria-expanded='true'] { background: color-mix(in srgb, var(--text) 6%, transparent); }
.nav[aria-current='page'] { background: color-mix(in srgb, var(--text) 9%, transparent); font-weight: 600; }
.nav[aria-disabled='true'] { color: var(--muted); cursor: default; }
.nav[aria-disabled='true']:hover { background: transparent; }
.nav .grow { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nav kbd { font: 11px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--muted); }
.nav.new { border: 1px solid var(--gc-color-line-strong); background: var(--panel); font-weight: 600; margin-bottom: 4px; }
.side-scroll { flex: 1; overflow-y: auto; padding: 0 10px 10px; min-height: 0; }
.group-h { padding: 14px 9px 4px; font-size: 11px; font-weight: 650; letter-spacing: .05em; text-transform: uppercase; color: var(--muted); }
.proj { margin-bottom: 2px; }
.proj > summary { list-style: none; display: flex; align-items: center; gap: 7px; height: 28px; padding: 0 2px 0 9px; border-radius: 8px; font-size: 12px; font-weight: 600; color: var(--muted); cursor: pointer; }
.proj > summary::-webkit-details-marker { display: none; }
.proj > summary:hover { background: color-mix(in srgb, var(--text) 6%, transparent); color: var(--text); }
.proj > summary .grow { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.proj > summary .chev { transition: transform .15s; width: 12px; height: 12px; }
.proj[open] > summary .chev { transform: rotate(90deg); }
.proj > summary .add { opacity: 0; }
.proj > summary:hover .add, .proj > summary .add:focus-visible { opacity: 1; }
.nav.chat { padding-left: 14px; height: 30px; }
.nav.chat small { color: var(--muted); font-size: 12px; }
.nav.chat.all { color: var(--muted); padding-left: 35px; }
.tag { font-size: 11px; font-weight: 600; color: var(--muted); border: 1px solid var(--gc-color-line-strong); border-radius: 4px; padding: 0 4px; line-height: 16px; white-space: nowrap; }
.side-foot { border-top: 1px solid var(--line); padding: 8px 10px; display: grid; gap: 2px; flex: none; position: relative; }
.quota { display: grid; gap: 4px; padding: 6px 9px 8px; border: 0; background: transparent; width: 100%; text-align: left; border-radius: 8px; cursor: pointer; }
.quota:hover { background: color-mix(in srgb, var(--text) 6%, transparent); }
.quota-row { display: grid; grid-template-columns: 64px 1fr 76px; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); }
.quota-row > :first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.quota-row > :last-child { text-align: right; white-space: nowrap; }
.meter { height: 4px; border-radius: 2px; background: var(--gc-color-line-strong); overflow: hidden; }
.meter i { display: block; height: 100%; background: var(--gc-color-ok); border-radius: 2px; }
.quota-row[data-level='warning'] .meter i { background: var(--gc-color-warn); }
.quota-row[data-level='exceeded'] .meter i { background: var(--gc-color-err); }
.ring { --ring: var(--gc-color-ok); display: none; width: 28px; height: 28px; border-radius: 50%; place-items: center; font-size: 11px; font-weight: 700; color: var(--text); position: relative; background: conic-gradient(var(--ring) var(--used, 0%), var(--gc-color-line-strong) 0); }
.ring[data-level='warning'] { --ring: var(--gc-color-warn); }
.ring[data-level='exceeded'] { --ring: var(--gc-color-err); }
.ring::after { content: ''; position: absolute; inset: 3px; border-radius: 50%; background: var(--gc-color-side); }
.ring b { position: relative; z-index: 1; }
.update { display: flex; align-items: center; gap: 8px; padding: 7px 9px; border-radius: 8px; background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--accent); font-size: 12px; font-weight: 600; border: 0; width: 100%; text-align: left; cursor: pointer; }
.update:disabled { cursor: default; opacity: .75; }
.foot-row { display: flex; align-items: center; gap: 2px; }
.foot-row .menu-anchor { flex: 1; min-width: 0; display: flex; }
.badge-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); flex: none; }
.conn { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); padding: 2px 9px 0; white-space: nowrap; }
.conn.off { color: var(--gc-color-err); }
.menu-anchor { position: relative; }
.menu { position: absolute; z-index: 40; min-width: 220px; padding: 5px; border-radius: 12px; background: var(--panel); border: 1px solid var(--line); box-shadow: var(--gc-elevation-2); user-select: text; -webkit-user-select: text; }
.menu.up { bottom: calc(100% + 6px); left: 0; }
.menu button, .menu a { display: flex; align-items: center; gap: 9px; width: 100%; height: 30px; padding: 0 9px; border: 0; background: transparent; border-radius: 6px; font-size: 13px; text-align: left; text-decoration: none; color: var(--text); cursor: pointer; white-space: nowrap; }
.menu button:hover, .menu a:hover { background: var(--gc-color-sunken); }
.menu button:focus-visible, .menu a:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.menu hr { border: 0; border-top: 1px solid var(--line); margin: 5px 0; }
.side-popover { position: absolute; left: 10px; bottom: 100%; }
.side-popover .popover { top: auto; bottom: 6px; left: 0; right: auto; }
.side-collapsed .side .label, .side-collapsed .side .group-h, .side-collapsed .side .proj, .side-collapsed .side kbd, .side-collapsed .side .quota-row, .side-collapsed .side .conn span, .side-collapsed .side .other, .side-collapsed .side-toggle, .side-collapsed .brand { display: none; }
.side-collapsed .side-top { padding: 0; }
.side-collapsed .nav { justify-content: center; padding: 0; }
.side-collapsed .nav .count { position: absolute; top: 1px; right: 4px; min-width: 15px; height: 15px; }
.side-collapsed .nav .badge-dot { position: absolute; top: 5px; right: 9px; }
.side-collapsed .foot-row { flex-direction: column; }
.side-collapsed .foot-row .menu-anchor { width: 100%; }
.side-collapsed .update { justify-content: center; padding: 7px 0; }
.side-collapsed .update span { display: none; }
.side-collapsed .quota { padding: 6px 0; justify-items: center; }
.side-collapsed .quota .ring { display: grid; }
.side-collapsed .conn { justify-content: center; padding: 4px 0 0; }
.topbar { display: flex; align-items: center; gap: 8px; height: 46px; padding: 0 12px 0 16px; border-bottom: 1px solid var(--line); background: var(--panel); flex: none; position: relative; z-index: 30; }
/* Rail: the Mac's window buttons overhang the 56px rail, so the bar starts 88px from the window's edge. */
.mac-app .side-collapsed .topbar { padding-left: 32px; }
.topbar h1 { margin: 0; font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 60px; }
.topbar .conv-topic { font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.topbar .sep { color: var(--muted); }
.crumb { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--muted); white-space: nowrap; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.tokens { font-size: 12px; color: var(--muted); white-space: nowrap; }
.topbar .tm-wrap { flex: none; }
@media (max-width: 760px) { .tokens { display: none; } }
.wolf { width: 180px; height: 180px; margin: 0 auto 12px; background: var(--wolf) center / contain no-repeat; }
.has-turns .workspace::before { content: ''; position: absolute; inset: 18px 0 120px; background: var(--wolf) center / min(420px, 60%) no-repeat; opacity: .06; pointer-events: none; z-index: 0; }
button.chip { cursor: pointer; }
button.chip:hover { border-color: var(--accent); }
.release-dialog { max-height: 78vh; width: min(640px, 92vw); overflow: auto; padding: 20px 24px; color: var(--text); background: var(--panel); border: 1px solid var(--line); border-radius: 12px; box-shadow: var(--shadow); font-weight: 400; letter-spacing: normal; user-select: text; -webkit-user-select: text; }
.release-dialog::backdrop { background: rgba(0, 0, 0, .4); }
.release-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.release-heading h2 { margin: 0; font-size: 20px; }
.release-dialog a { color: var(--accent); }
/* The composer (docs/design/desktop-layout.md, "Composer"): the card of <AgentChat composerLayout="card"> with the page's controls in its row. */
.workspace .gc-card { background: var(--panel); }
.gc-card[data-disabled='1'] { opacity: .65; }
.gc-card-row .btn.sm, .gc-composer-header .btn.sm { flex: none; }
.gc-card-row .btn.ghost[aria-pressed='true'] { background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--accent); }
.agent-chip { color: var(--text); max-width: 100%; min-width: 0; }
.agent-chip .av { width: 16px; height: 16px; border-radius: 5px; display: inline-grid; place-items: center; font-size: 11px; font-weight: 700; background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--accent); flex: none; }
.agent-chip .chip-long { color: var(--muted); overflow: hidden; text-overflow: ellipsis; max-width: 22em; }
.seg { display: inline-flex; padding: 2px; border-radius: 8px; background: var(--gc-color-sunken); border: 1px solid var(--line); flex: none; }
.shell .seg button { border: 0; background: transparent; height: 24px; padding: 0 9px; border-radius: 6px; font-size: 12px; font-weight: 500; color: var(--muted); white-space: nowrap; cursor: pointer; }
.shell .seg button[aria-pressed='true'] { background: var(--panel); color: var(--text); box-shadow: 0 1px 2px rgba(0, 0, 0, .12); }
.shell .seg button:disabled { opacity: .55; cursor: default; }
.shell .seg button:focus-visible, .shell .agent-opt:focus-visible, .shell .field:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.field { height: 30px; padding: 0 10px; border-radius: 8px; border: 1px solid var(--gc-color-line-strong); background: var(--panel); color: var(--text); font-size: 13px; min-width: 0; }
.field.mono { font-family: var(--mono); font-size: 12px; }
.field::placeholder { color: var(--faint); }
.pop { position: absolute; bottom: calc(100% + 8px); left: 0; z-index: 40; width: 320px; max-width: calc(100vw - 32px); max-height: min(70vh, 520px); overflow: auto; padding: 12px; border-radius: 12px; background: var(--panel); border: 1px solid var(--line); box-shadow: var(--gc-elevation-2); display: grid; gap: 10px; text-align: left; color: var(--text); }
.pop.starts-pop { width: 380px; }
/* Long content (a path, the complaint about it) wraps: the popover's column never grows past it. */
.pop { grid-template-columns: minmax(0, 1fr); }
.pop > *, .pop label, .pop .pop-field { min-width: 0; }
.pop .note { overflow-wrap: anywhere; }
/* In the composer a popover opens from a control near the card's left edge: it is no wider than the card, so its buttons stay in a narrow window. */
.workspace .gc-card { container-type: inline-size; }
.gc-card .pop { max-width: calc(100cqw - 16px); }
/* "Starts in" sits after its label: its popover opens from the card's edge, not the button's. */
.gc-composer-header .menu-anchor:has(> .starts-pop) { position: static; }
.starts-path .btn { flex: none; }
.pop label, .pop .pop-field { display: grid; gap: 4px; font-size: 12px; color: var(--muted); }
.pop .seg { width: fit-content; max-width: 100%; flex-wrap: wrap; }
.pop .note { font-size: 12px; color: var(--muted); }
.pop .note.err { color: var(--gc-color-err); }
.agent-list, .starts-list { display: grid; gap: 2px; }
.shell .agent-opt { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 6px; border: 0; background: transparent; width: 100%; text-align: left; font-size: 13px; color: var(--text); cursor: pointer; min-width: 0; }
.shell .agent-opt:hover:not(:disabled) { background: var(--gc-color-sunken); }
.shell .agent-opt:disabled { opacity: .55; cursor: default; }
.shell .agent-opt[aria-checked='true'] { background: var(--gc-color-accent-soft); }
.shell .agent-opt small, .shell .picker-row small { margin-left: auto; color: var(--muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.opt-name { font-weight: 500; white-space: nowrap; }
.shell .agent-opt.picker-connect { color: var(--accent); border-top: 1px solid var(--line); border-radius: 0 0 6px 6px; margin-top: 4px; padding-top: 8px; }
.picker-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; background: var(--faint); }
.picker-dot[data-state='ready'] { background: var(--gc-color-ok); }
.picker-dot[data-state='signed-out'], .picker-dot[data-state='broken'] { background: var(--gc-color-warn); }
.picker-dot[data-state='installed'] { background: var(--accent); }
.picker-section { display: grid; gap: 2px; }
.picker-heading { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); padding: 6px 8px 2px; border-top: 1px solid var(--line); margin-top: 4px; }
.picker-row { display: flex; align-items: center; gap: 8px; padding: 4px 8px; border-radius: 6px; font-size: 13px; }
.picker-row.muted .opt-name { color: var(--muted); }
.picker-row .btn.sm { flex: none; }
.picker-row small + .btn { margin-left: 0; }
.picker-row .opt-name + .btn { margin-left: auto; }
.starts-path { display: flex; gap: 6px; min-width: 0; }
.starts-path .field { flex: 1; }
.starts-fixed { display: inline-flex; align-items: center; gap: 6px; font-weight: 500; color: var(--text); }
.starts-where { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 6em; flex: 1 1 0; }
.gc-composer-header .btn.sm svg.i, .starts-fixed svg.i, .agent-opt svg.i { width: 14px; height: 14px; }
.workspace .gc-hint { font-size: 12px; color: var(--faint); padding: 0 6px; }
.workspace .gc-hint .hot { color: var(--gc-color-err); font-weight: 600; white-space: nowrap; }
/* A message sent while the agent works keeps its receipt: one quiet line, the state in its hue. */
.workspace .gc-prompt.gc-steer small { font-size: 12px; font-weight: 600; }
.workspace .gc-prompt.gc-steer[data-delivery='delivered'] small { color: var(--gc-color-run); }
.workspace .gc-prompt.gc-steer[data-delivery='queued'] small { color: var(--gc-color-warn); }
.workspace .gc-prompt.gc-steer[data-delivery='dropped'] small { color: var(--gc-color-err); }
/* A narrow composer keeps Stop and the submit button on the row: the switch shows its one state, the chip its agent. */
@container (max-width: 800px) {
  .shell .seg.perm button:first-child { display: none; }
  .seg.perm { padding: 0; border-color: var(--gc-color-line-strong); background: var(--panel); }
  .shell .seg.perm button { height: 24px; box-shadow: none; }
  .shell .seg.perm button[aria-pressed='true'] { background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--accent); box-shadow: none; }
}
@container (max-width: 640px) {
  .chip-long { display: none; }
}
blockquote.unsent { margin: 6px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 8em; overflow: auto; color: var(--text); }
.sent-files { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.sent-files:first-child { margin-top: 0; }
.sent-files img { max-width: 160px; max-height: 120px; border-radius: 8px; border: 1px solid var(--line); display: block; }
.viewer-panel { position: relative; flex: none; width: min(var(--viewer-width, 620px), calc(100vw - 200px)); min-width: 320px; z-index: 20; display: flex; flex-direction: column; background: var(--panel); border-left: 1px solid var(--line); box-shadow: -8px 0 24px rgba(0, 0, 0, 0.08); }
.viewer-panel.full-size { position: fixed; inset: 0; width: 100vw; min-width: 0; z-index: 50; border-left: 0; box-shadow: none; }
.mac-app .viewer-panel.full-size header { padding-left: 88px; }
.viewer-resize { position: absolute; top: 0; bottom: 0; left: -4px; width: 8px; cursor: col-resize; z-index: 5; }
.viewer-resize:hover::after, .viewer-resize:focus-visible::after { content: ''; position: absolute; top: 0; bottom: 0; left: 3px; width: 2px; background: var(--accent); }
.viewer-panel header { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
.viewer-icon { color: var(--accent); }
.viewer-title { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; max-width: 38ch; }
.viewer-panel header small { color: var(--muted); font-size: 12px; white-space: nowrap; }
.viewer-panel header a.chip { text-decoration: none; cursor: pointer; }
.viewer-panel header a.chip:hover { border-color: var(--accent); }
.viewer-panel header .chip.primary, .viewer-actions .chip.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.viewer-version { font-size: 12px; background: var(--bg); border: 1px solid var(--line); border-radius: 999px; padding: 2px 8px; cursor: pointer; }
.viewer-body { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: auto; }
.viewer-frame { flex: 1; width: 100%; height: 100%; border: 0; background: #fff; }
.viewer-markdown { padding: 18px 22px; overflow: auto; }
.viewer-stage { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 16px; overflow: auto; gap: 10px; }
.viewer-image-stage { background: repeating-conic-gradient(rgba(128, 128, 128, 0.08) 0% 25%, transparent 0% 50%) 50% / 16px 16px; }
.viewer-image-stage img { max-width: 100%; max-height: 100%; object-fit: contain; cursor: zoom-in; display: block; }
.viewer-image-stage.actual { align-items: flex-start; justify-content: flex-start; }
.viewer-image-stage.actual img { max-width: none; max-height: none; cursor: zoom-out; }
.viewer-video-stage { background: #000; }
.viewer-video-stage video { max-width: 100%; max-height: 100%; }
.viewer-fallback { text-align: center; color: var(--muted); }
.viewer-fallback p { margin: 0; }
.viewer-meta { font-size: 13px; color: var(--muted); }
.viewer-refused-path { font-family: var(--mono); font-size: 12.5px; color: var(--text); background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 4px 10px; max-width: 100%; overflow-wrap: anywhere; }
.viewer-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; margin-top: 4px; }
.viewer-actions a.chip { text-decoration: none; cursor: pointer; }
.file-text { flex: 1; margin: 0; overflow: auto; padding: 10px 0; font: 12.5px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; counter-reset: line; tab-size: 2; }
.file-text span { display: block; padding: 0 14px 0 0; white-space: pre; counter-increment: line; }
.file-text span::before { content: counter(line); display: inline-block; width: 3.5em; padding-right: 1em; text-align: right; color: var(--faint); user-select: none; }
.file-text span.file-line-mark { background: color-mix(in srgb, var(--accent) 16%, transparent); box-shadow: inset 3px 0 0 var(--accent); }
.file-problem { margin: 0; padding: 12px 14px; color: var(--muted); font-size: 13px; }
.popover-anchor { position: relative; }
.popover { position: absolute; top: calc(100% + 6px); right: 0; z-index: 40; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18); min-width: 280px; max-width: min(380px, calc(100vw - 24px)); }
.artifacts-popover { padding: 6px; display: flex; flex-direction: column; gap: 2px; max-height: 60vh; overflow: auto; }
.artifact-list-item { display: grid; grid-template-columns: 16px 1fr; gap: 2px 8px; align-items: baseline; text-align: left; background: transparent; border: 0; border-radius: 7px; padding: 7px 9px; cursor: pointer; width: 100%; }
.artifact-list-item:hover, .artifact-list-item.active { background: color-mix(in srgb, var(--accent) 12%, transparent); }
.artifact-list-icon { color: var(--accent); grid-row: span 2; }
.artifact-list-title { font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.artifact-list-meta { font-size: 11.5px; color: var(--muted); }
.settings-popover { padding: 14px; display: flex; flex-direction: column; gap: 10px; width: 340px; }
.settings-popover h3 { margin: 0; font-size: 14px; }
.settings-toggle { display: flex; gap: 8px; align-items: flex-start; font-size: 13px; cursor: pointer; }
.settings-toggle input { margin-top: 3px; accent-color: var(--accent); }
.settings-field { display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; color: var(--muted); }
.settings-field textarea { font-family: var(--mono); font-size: 12px; padding: 6px 8px; border-radius: 7px; border: 1px solid var(--line); background: var(--bg); color: var(--text); resize: vertical; }
.settings-note { margin: 0; font-size: 11.5px; color: var(--muted); line-height: 1.45; }
.settings-error { font-size: 12px; color: var(--err); }
.settings-actions { display: flex; gap: 8px; justify-content: flex-end; }
.settings-actions .chip.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
@media (max-width: 860px) {
  .viewer-panel { position: fixed; inset: 0; width: 100vw; min-width: 0; border-left: 0; }
  .viewer-resize { display: none; }
}
.spacer { flex: 1; }
.chip { font-size: 12px; color: var(--muted); background: var(--bg); border: 1px solid var(--line); border-radius: 999px; padding: 3px 10px; white-space: nowrap; }
.chip[data-level='warning'] { color: #e8590c; border-color: currentColor; }
.chip[data-level='exceeded'] { color: var(--err); border-color: currentColor; }
.chip.waits { color: var(--accent); border-color: currentColor; }
.chip.waits.on { color: var(--bg); background: var(--accent); }
.gc-empty h1 { color: var(--text); font-size: 26px; letter-spacing: -.02em; margin: 0 0 8px; }
.ideas { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; margin-top: 20px; }
.ideas button { background: var(--panel); border: 1px solid var(--line); border-radius: 999px; padding: 7px 14px; cursor: pointer; box-shadow: var(--shadow); }
.ideas button:hover { border-color: var(--accent); }
.home { max-width: 640px; margin: 28px auto 0; text-align: left; display: flex; flex-direction: column; gap: 6px; }
.home h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 14px 0 2px; }
.home .plans { display: flex; gap: 18px; flex-wrap: wrap; justify-content: center; align-items: flex-start; }
.home .plan { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--muted); min-width: 240px; flex: 1; }
.home .plan > span { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.home .plan > small { font-size: 11px; }
.home .went { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
.home .went li { position: relative; display: flex; justify-content: space-between; gap: 8px; padding: 2px 6px; border-radius: 5px; overflow: hidden; }
.home .went li > i { position: absolute; left: 0; top: 0; bottom: 0; background: var(--accent); opacity: .16; }
.home .went li > :not(i) { position: relative; z-index: 1; }
.home .went button, .home .went span { background: none; border: 0; padding: 0; font: inherit; color: var(--text); text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.home .went button { cursor: pointer; }
.home .went button:hover { text-decoration: underline; }
.home .went b { font-weight: 500; color: var(--muted); }
.home .topic { display: flex; align-items: center; gap: 8px; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 6px 10px; color: var(--text); }
.home .topic:hover { border-color: var(--accent); }
.home .topic-open { flex: 1; min-width: 0; display: flex; justify-content: space-between; gap: 12px; align-items: baseline; text-align: left; background: none; border: 0; padding: 3px 2px; cursor: pointer; color: inherit; }
.home .topic-open span { font-size: 12px; color: var(--muted); white-space: nowrap; }
.home .topic-new { flex-shrink: 0; }
.home details.stalled { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
.home details.stalled > summary { cursor: pointer; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 6px 0 2px; list-style-position: inside; }
.home details.stalled > summary small { text-transform: none; letter-spacing: 0; margin-left: 8px; opacity: .8; }
.home details.stalled[open] > .topic { margin-top: 6px; width: 100%; box-sizing: border-box; opacity: .85; }
.project > summary .topic-new { font-size: 12px; background: var(--bg); border: 1px solid var(--line); border-radius: 999px; padding: 1px 9px; cursor: pointer; color: var(--muted); white-space: nowrap; }
.project > summary .topic-new:hover { border-color: var(--accent); color: var(--text); }
.session-row .label small.topic-tag { color: var(--accent); }
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
.session-row .mark[data-state='now'] { color: #e03131; }
.session-row .mark[data-state='stalled'] { color: var(--muted); }
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
.more { padding: 6px 12px; border-top: 1px solid var(--line); display: flex; gap: 16px; }
.more button { background: none; border: 0; color: var(--accent); cursor: pointer; font-size: 13px; padding: 0; }
.tm-wrap { position: relative; display: inline-flex; }
.tm-popover { position: absolute; right: 0; top: calc(100% + 5px); z-index: 30; min-width: 240px; max-width: min(360px, calc(100vw - 24px)); padding: 5px; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; box-shadow: 0 8px 28px rgba(0, 0, 0, .16); display: flex; flex-direction: column; gap: 1px; user-select: text; -webkit-user-select: text; }
.tm-popover.tm-up { top: auto; bottom: calc(100% + 5px); }
.tm-head { padding: 5px 8px 6px; border-bottom: 1px solid var(--line); margin-bottom: 3px; display: flex; flex-direction: column; gap: 3px; }
.tm-meta { display: flex; align-items: baseline; gap: 6px; font-size: 11px; color: var(--muted); min-width: 0; }
.tm-meta span { flex: 0 0 26px; text-transform: uppercase; letter-spacing: .04em; color: var(--faint); }
.tm-meta code { font-family: var(--mono); color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.tm-wrap .tm-popover button { display: block; width: 100%; text-align: left; background: transparent; border: 0; border-radius: 6px; padding: 6px 8px; font-size: 13px; color: var(--text); cursor: pointer; white-space: nowrap; }
.tm-wrap .tm-popover button:hover { background: var(--bg); color: var(--accent); border-color: transparent; }
.tm-wrap .tm-popover button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.tm-popover hr { border: 0; border-top: 1px solid var(--line); margin: 4px 2px; }
.gc-toast { position: fixed; right: 18px; bottom: 18px; z-index: 60; padding: 8px 13px; border-radius: 9px; background: var(--panel); color: var(--text); border: 1px solid var(--line); box-shadow: 0 6px 24px rgba(0, 0, 0, .16); font-size: 13px; max-width: min(380px, calc(100vw - 36px)); }
.gc-toast.err { color: var(--err); border-color: currentColor; }
.agents-panel { flex: 1; overflow: auto; padding: 20px 20px 48px; position: relative; z-index: 1; }
.onboarding { max-width: 700px; margin: 0 auto; text-align: left; }
.onboarding-hero { text-align: center; margin-bottom: 18px; }
.onboarding-hero h1 { font-size: 24px; letter-spacing: -.02em; margin: 0 0 6px; color: var(--text); }
.onboarding-hero p { margin: 0 auto; max-width: 540px; font-size: 14px; color: var(--muted); }
.wolf.wolf-compact { width: 96px; height: 96px; margin: 0 auto 10px; }
.onboarding-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.onboarding-head h1 { font-size: 22px; margin: 0 0 4px; letter-spacing: -.02em; }
.onboarding-head p { margin: 0; font-size: 14px; color: var(--muted); }
.onboarding-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
.onboarding-note { font-size: 13px; color: var(--muted); }
.btn-primary { background: var(--accent); color: #fff; border: 0; border-radius: 8px; padding: 6px 14px; font-size: 13px; font-weight: 500; cursor: pointer; }
.btn-primary:disabled { opacity: .6; cursor: default; }
.btn-use { background: var(--bg); color: var(--text); border: 1px solid var(--line); border-radius: 7px; padding: 4px 12px; font-size: 13px; cursor: pointer; white-space: nowrap; }
.btn-use:hover { border-color: var(--accent); color: var(--accent); }
.agent-cards { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.agent-card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 13px 15px; box-shadow: var(--shadow); }
.agent-card.focused { border-color: var(--accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 22%, transparent); }
.card-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.card-title { display: flex; align-items: baseline; gap: 7px; flex-wrap: wrap; }
.card-title strong { font-size: 15px; font-weight: 600; color: var(--text); }
.card-maker { font-size: 12px; color: var(--muted); }
.card-cmd { font-family: var(--mono); font-size: 12px; color: var(--faint); }
.card-ver { font-family: var(--mono); font-size: 11.5px; color: var(--faint); }
.card-badges { display: flex; align-items: center; gap: 6px; }
.plan-pill { font-size: 11.5px; padding: 2px 8px; border-radius: 999px; background: var(--bg); border: 1px solid var(--line); color: var(--muted); }
.status-pill { font-size: 12px; font-weight: 500; padding: 2px 9px; border-radius: 999px; white-space: nowrap; border: 1px solid var(--line); background: var(--bg); color: var(--muted); }
.status-pill[data-state='ready'] { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 40%, transparent); background: color-mix(in srgb, var(--ok) 10%, var(--panel)); }
.status-pill[data-state='signed-out'], .status-pill[data-state='broken'] { color: #c45d00; border-color: color-mix(in srgb, #e8590c 40%, transparent); background: color-mix(in srgb, #e8590c 9%, var(--panel)); }
@media (prefers-color-scheme: dark) {
  .status-pill[data-state='signed-out'], .status-pill[data-state='broken'] { color: #ffb35c; }
}
.card-summary { margin: 5px 0 0; font-size: 13px; color: var(--muted); }
.card-step { margin-top: 10px; display: flex; flex-direction: column; gap: 6px; }
.card-ready-row { flex-direction: row; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.card-meta { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.card-limits { display: flex; gap: 6px; flex-wrap: wrap; }
.step-commands { display: flex; flex-direction: column; gap: 5px; }
.step-label { font-size: 11.5px; text-transform: uppercase; letter-spacing: .04em; color: var(--faint); }
.step-note { font-size: 13px; color: var(--text); }
.step-hint { font-size: 12px; color: var(--muted); overflow-wrap: anywhere; }
.step-error { font-size: 12.5px; color: var(--err); background: color-mix(in srgb, var(--err) 8%, var(--panel)); border: 1px solid color-mix(in srgb, var(--err) 30%, transparent); border-radius: 6px; padding: 6px 9px; font-family: var(--mono); overflow-wrap: anywhere; }
.step-docs { font-size: 12px; color: var(--muted); overflow-wrap: anywhere; }
.docs-link { color: var(--accent); text-decoration: none; }
.docs-link:hover { text-decoration: underline; }
.copy-row { display: flex; align-items: center; gap: 8px; background: var(--bg); border: 1px solid var(--line); border-radius: 7px; padding: 5px 7px 5px 10px; }
.copy-row code { flex: 1; font-family: var(--mono); font-size: 12.5px; overflow-x: auto; white-space: nowrap; user-select: all; -webkit-user-select: all; color: var(--text); }
.copy-btn { background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 2px 9px; font-size: 12px; color: var(--muted); cursor: pointer; white-space: nowrap; }
.copy-btn:hover { border-color: var(--accent); color: var(--text); }
.signin-card { background: var(--panel); border: 1px solid color-mix(in srgb, #e8590c 35%, var(--line)); border-radius: 10px; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
.signin-card.ready { border-color: color-mix(in srgb, var(--ok) 40%, var(--line)); }
.signin-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.signin-head strong { font-size: 14px; }
.signin-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.setup-banner { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; background: var(--panel); border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--line)); border-radius: 10px; padding: 11px 14px; margin-top: 8px; box-shadow: var(--shadow); }
.setup-banner-copy { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.setup-banner-copy strong { font-size: 13.5px; color: var(--text); }
.setup-banner-copy span { font-size: 12.5px; color: var(--muted); }
.setup-banner-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
@media (max-width: 640px) {
  .session-row { grid-template-columns: 16px 70px 34px 1fr; }
  .session-row .act { grid-column: 2 / -1; flex-wrap: wrap; }
}
`;
