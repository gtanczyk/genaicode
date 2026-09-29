/** What the plugin tells the overlay. */
export interface OverlayConfig {
  /** Path of the plugin's endpoints on the dev server, e.g. `/__genaicode`. */
  api: string;
  /** Collect errors from the page and offer to send them to the agent. */
  captureErrors: boolean;
}

/** The part of Vite's `import.meta.hot` the overlay listens to. */
export interface OverlayHot {
  on(event: string, callback: (payload: unknown) => void): void;
}

/**
 * The dev-server overlay: a wolf in the corner of the app that opens the genaicode UI in a
 * panel, and collects the page's errors so one click sends them to the agent.
 *
 * The plugin serves this function's source (`mountOverlay.toString()`) as a module, so it must
 * not use anything from outside its own body.
 */
export function mountOverlay(config: OverlayConfig, hot: OverlayHot | undefined): void {
  if (document.querySelector('genaicode-overlay')) return;

  interface PageError {
    source: 'vite' | 'error' | 'rejection' | 'console';
    message: string;
    stack?: string;
  }
  const MAX_ERRORS = 20;
  const MAX_TEXT = 4000;
  let errors: PageError[] = [];
  let session: { url: string; agent: string } | undefined;

  const host = document.createElement('genaicode-overlay');
  host.style.cssText = 'position:fixed;z-index:2147483647;right:0;bottom:0;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
:host { all: initial; }
* { box-sizing: border-box; font: 13px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
.wolf { position: fixed; right: 18px; bottom: 18px; width: 52px; height: 52px; border-radius: 50%; border: 1px solid #e4e4df;
  background: #fff center / 34px no-repeat; box-shadow: 0 2px 10px rgba(0,0,0,.18); cursor: pointer; padding: 0; font-size: 26px; }
.wolf:hover { transform: scale(1.06); }
.badge { position: absolute; top: -4px; right: -4px; min-width: 20px; height: 20px; padding: 0 5px; border-radius: 10px;
  background: #c92a2a; color: #fff; font-size: 11px; font-weight: 700; line-height: 20px; text-align: center; }
.badge[hidden], .panel[hidden], .fix[hidden] { display: none; }
.panel { position: fixed; right: 18px; bottom: 82px; width: min(460px, calc(100vw - 36px)); height: min(680px, calc(100vh - 110px));
  display: flex; flex-direction: column; background: #fff; border: 1px solid #e4e4df; border-radius: 14px; overflow: hidden;
  box-shadow: 0 8px 40px rgba(0,0,0,.22); }
.head { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid #e4e4df; background: #f7f7f5; color: #1d1d1b; }
.head b { flex: 1; }
.head button { border: 1px solid #e4e4df; background: #fff; color: #1d1d1b; border-radius: 8px; padding: 4px 10px; cursor: pointer; }
.head .fix { background: #c92a2a; border-color: #c92a2a; color: #fff; font-weight: 600; }
iframe { flex: 1; width: 100%; border: 0; background: #f7f7f5; }
.note { padding: 16px; color: #6b6b66; }
@media (prefers-color-scheme: dark) {
  .wolf, .panel { background-color: #1d1d1c; border-color: #2e2e2c; }
  .head { background: #141414; border-color: #2e2e2c; color: #ececea; }
  .head button { background: #1d1d1c; border-color: #2e2e2c; color: #ececea; }
  iframe { background: #141414; }
}
</style>
<div class="panel" hidden>
  <div class="head"><b>genaicode</b><button class="fix" hidden></button><button class="close" title="Hide">✕</button></div>
</div>
<button class="wolf" title="genaicode"><span class="badge" hidden></span></button>`;
  const $ = <T extends Element>(selector: string) => root.querySelector(selector) as T;
  const wolf = $<HTMLButtonElement>('.wolf');
  const badge = $<HTMLElement>('.badge');
  const panel = $<HTMLElement>('.panel');
  const fix = $<HTMLButtonElement>('.fix');
  let frame: HTMLElement | undefined;

  const render = () => {
    badge.hidden = errors.length === 0;
    badge.textContent = String(errors.length);
    fix.hidden = errors.length === 0;
    fix.textContent = `Fix ${errors.length} error${errors.length === 1 ? '' : 's'}`;
    wolf.title = errors.length
      ? `genaicode: ${errors.length} error${errors.length === 1 ? '' : 's'} on this page`
      : `genaicode${session ? ` (${session.agent})` : ''}`;
  };

  const loadSession = async () => {
    if (session) return session;
    const response = await fetch(`${config.api}/session`, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`genaicode: ${response.status}`);
    session = (await response.json()) as { url: string; agent: string };
    wolf.style.backgroundImage = `url(${new URL('/assets/wolf-64.png', session.url).href})`;
    render();
    return session;
  };

  const open = async () => {
    panel.hidden = false;
    if (frame) return;
    try {
      const { url } = await loadSession();
      const iframe = document.createElement('iframe');
      iframe.src = url;
      iframe.title = 'genaicode';
      frame = iframe;
    } catch (error) {
      const note = document.createElement('div');
      note.className = 'note';
      note.textContent = `The genaicode UI is not available: ${(error as Error).message}. See the dev server's terminal.`;
      frame = note;
    }
    panel.append(frame);
  };

  wolf.addEventListener('click', () => (panel.hidden ? void open() : (panel.hidden = true)));
  $<HTMLButtonElement>('.close').addEventListener('click', () => (panel.hidden = true));
  fix.addEventListener('click', async () => {
    const sent = errors;
    errors = [];
    render();
    await open();
    const response = await fetch(`${config.api}/fix`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ page: location.href, errors: sent }),
    }).catch(() => undefined);
    if (!response?.ok) {
      errors = [...sent, ...errors].slice(-MAX_ERRORS);
      render();
    }
  });

  const text = (value: unknown): string => {
    if (value instanceof Error) return value.message;
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value) ?? String(value);
    } catch {
      return String(value);
    }
  };
  const add = (error: PageError) => {
    error.message = error.message.slice(0, MAX_TEXT);
    if (error.stack) error.stack = error.stack.slice(0, MAX_TEXT);
    if (errors.some((seen) => seen.message === error.message && seen.source === error.source)) return;
    errors = [...errors, error].slice(-MAX_ERRORS);
    render();
  };

  if (config.captureErrors) {
    window.addEventListener('error', (event) => {
      const where = event.filename ? ` (${event.filename}:${event.lineno}:${event.colno})` : '';
      add({ source: 'error', message: `${event.message}${where}`, stack: (event.error as Error | undefined)?.stack });
    });
    window.addEventListener('unhandledrejection', (event) => {
      add({ source: 'rejection', message: text(event.reason), stack: (event.reason as Error | undefined)?.stack });
    });
    const consoleError = console.error.bind(console);
    console.error = (...args: unknown[]) => {
      consoleError(...args);
      add({
        source: 'console',
        message: args.map(text).join(' '),
        stack: args.find((arg): arg is Error => arg instanceof Error)?.stack,
      });
    };
    hot?.on('vite:error', (payload) => {
      const err = (payload as { err?: { message?: string; frame?: string; id?: string; stack?: string } }).err;
      if (!err) return;
      const file = err.id ? `\n${err.id}` : '';
      add({ source: 'vite', message: `${err.message ?? 'Vite error'}${file}${err.frame ? `\n${err.frame}` : ''}` });
    });
    // A successful update means the build errors are gone; keep what the running page reported.
    hot?.on('vite:afterUpdate', () => {
      const before = errors.length;
      errors = errors.filter((error) => error.source !== 'vite');
      if (errors.length !== before) render();
    });
  }

  document.body.append(host);
  render();
  void loadSession().catch(() => {
    wolf.textContent = '🐺';
    wolf.append(badge);
  });
}
