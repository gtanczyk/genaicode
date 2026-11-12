// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionState } from '../agents/session.js';
import { AgentChat, artifactSubmission, Markdown, type AgentChatProps } from '../react.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const t0 = Date.parse('2026-10-06T10:00:00Z');

/** A session mid-way through its second turn. */
function fixture(patch: Partial<SessionState> = {}): SessionState {
  return {
    agent: 'claude',
    cwd: '/work/app',
    model: 'sonnet',
    sessionId: 'ses_0123456789abcdef',
    status: 'running',
    canSteer: false,
    usage: { inputTokens: 1200, outputTokens: 300 },
    costUsd: 0.012,
    queued: ['CONTEXT: x\n\nOperator: then run the tests'],
    approvals: [{ id: 'ap-1', kind: 'command', summary: 'rm -rf build' }],
    turns: [
      {
        id: 1,
        agent: 'claude',
        prompt: 'CONTEXT: x\n\nOperator: fix the build',
        startedAt: t0,
        endedAt: t0 + 12_000,
        result: { status: 'completed', ok: true, exitCode: 0, signal: null },
        entries: [
          {
            kind: 'tool',
            id: 't1',
            name: 'Bash',
            input: { command: 'npm run build' },
            output: 'error TS2304',
            done: true,
          },
          { kind: 'tool', id: 't2', name: 'mcp__ops__queue', input: {}, output: 'boom', isError: true, done: true },
          { kind: 'files', paths: ['/work/app/src/a.ts'] },
          {
            kind: 'text',
            text: 'Fixed **two** things:\n\n- `a.ts`\n- see [docs](https://example.com/docs)\n\n<img src=x onerror=alert(1)>',
            streaming: false,
          },
        ],
      },
      {
        id: 2,
        agent: 'claude',
        prompt: 'CONTEXT: x\n\nOperator: clean up',
        startedAt: t0 + 20_000,
        entries: [
          { kind: 'approval', request: { id: 'ap-1', kind: 'command', summary: 'rm -rf build' } },
          { kind: 'error', message: 'rate limited' },
          { kind: 'text', text: 'Cleaning', streaming: true },
        ],
      },
    ],
    ...patch,
  };
}

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(props: Partial<AgentChatProps> = {}) {
  const all: AgentChatProps = { state: fixture(), onSend: vi.fn(), onStop: vi.fn(), ...props };
  act(() => root.render(<AgentChat {...all} />));
  return all;
}

const $ = <T extends Element = HTMLElement>(selector: string) => container.querySelector(selector) as T;
const $$ = (selector: string) => Array.from(container.querySelectorAll(selector));
const text = (selector: string) => $$(selector).map((el) => el.textContent);

function type(value: string) {
  const box = $<HTMLTextAreaElement>('textarea');
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(box, value);
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const key = (init: KeyboardEventInit) =>
  act(() => {
    $('textarea').dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
  });
const click = (el: Element) => act(() => (el as HTMLElement).click());
const button = (label: string) => $$('button').find((el) => el.textContent === label);

describe('AgentChat', () => {
  it('renders a session: turns, tools, edits, markdown, errors, queue, busy state', () => {
    render();
    expect(text('.gc-prompt')).toEqual(['CONTEXT: x\n\nOperator: fix the build', 'CONTEXT: x\n\nOperator: clean up']);
    expect(text('.gc-tool-name')).toEqual(['Shell', 'mcp__ops__queue']);
    expect(text('.gc-tool-arg')[0]).toBe('npm run build');
    expect($$('details.gc-tool')[0].hasAttribute('open')).toBe(false);
    expect($$('.gc-state')[1].className).toContain('gc-err');
    expect(text('.gc-files code')).toEqual(['src/a.ts']);
    expect(text('.gc-turn-footer')).toEqual(['done in 12s · claude']);
    expect($('.gc-working').textContent).toContain('claude is working');
    expect($('.gc-working [aria-hidden]')?.textContent).toMatch(/^· \d+/);
    expect(text('.gc-error')).toEqual(['rate limited']);
    expect($$('.gc-md')[1].className).toContain('gc-caret');
    expect(text('.gc-queued span')).toEqual(['⏸ CONTEXT: x\n\nOperator: then run the tests']);
    expect($('.gc-header').textContent).toContain('sonnet');
    expect($('.gc-header').textContent).toContain('…89abcdef');
    expect($('.gc-header').textContent).toContain('1.5k tokens · $0.012');
    expect($('.gc-chat').dataset.status).toBe('running');
    expect(button('Queue')).toBeTruthy();
  });

  it('shows the whole tool argument, not a cut one', () => {
    const command = `cd game && grep -rn "will" --include='*.ts' . | grep -v node_modules | head -50 ${'x'.repeat(300)}\necho done`;
    const state = fixture();
    state.turns[0].entries[0] = { kind: 'tool', id: 't1', name: 'Bash', input: { command }, output: 'ok', done: true };
    render({ state });
    expect($('.gc-tool-arg').textContent).toBe(command);
    expect($('.gc-tool summary').getAttribute('title')).toBe(command);
  });

  it('renders markdown safely', () => {
    render();
    const md = $$('.gc-md')[0];
    expect(md.querySelector('strong')?.textContent).toBe('two');
    expect(Array.from(md.querySelectorAll('li')).map((li) => li.textContent)).toEqual(['a.ts', 'see docs']);
    const link = md.querySelector('a')!;
    expect(link.getAttribute('href')).toBe('https://example.com/docs');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(md.querySelector('img')).toBeNull();
    expect(md.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('only links http(s) and mailto', () => {
    act(() =>
      root.render(
        <Markdown
          text={
            '[x](javascript:alert(1)) and https://ok.example/a. Then:\n\n```ts\nconst a = 1;\n```\n\n1. one\n2. two'
          }
        />,
      ),
    );
    expect($$('a').map((a) => a.getAttribute('href'))).toEqual(['https://ok.example/a']);
    expect($('pre code').className).toBe('language-ts');
    expect($('pre code').textContent).toBe('const a = 1;');
    expect(text('ol li')).toEqual(['one', 'two']);
  });

  it('renders headings, quotes, rules and item continuations, and stays fast on hostile text', () => {
    act(() =>
      root.render(<Markdown text={'## Plan\n\n> quoted *note*\n\n---\n\n- one\n  more\n- two\n\n#not a heading'} />),
    );
    expect($('h3').textContent).toBe('Plan');
    expect($('blockquote em').textContent).toBe('note');
    expect($('hr')).toBeTruthy();
    expect(text('ul li')).toEqual(['one\nmore', 'two']);
    expect(text('.gc-md > p')).toEqual(['#not a heading']);
    act(() =>
      root.render(<Markdown text={'[https://label.example **https://b.example**](https://destination.example)'} />),
    );
    expect($$('a').map((a) => a.getAttribute('href'))).toEqual(['https://destination.example']);
    expect($('a').textContent).toBe('https://label.example https://b.example');
    act(() => root.render(<Markdown text={'````md\n```js\nx\n```\n~~~literal\n````\n\n+ one\n1) two\n- three'} />));
    expect($('pre code').textContent).toBe('```js\nx\n```\n~~~literal');
    expect(text('ul li')).toEqual(['one', 'three']);
    expect(text('ol li')).toEqual(['two']);
    act(() => root.render(<Markdown text={'Intro\n***\nNext'} />));
    expect(text('.gc-md > *')).toEqual(['Intro', '', 'Next']);
    act(() => root.render(<Markdown text={`${'>'.repeat(50_000)} deep`} />));
    expect($$('blockquote')).toHaveLength(8);
    expect($('.gc-md').textContent).toContain('deep');
    const started = Date.now();
    act(() => root.render(<Markdown text={`${'['.repeat(20_000)}${' '.repeat(20_000)}x\n${'- '.repeat(10_000)}`} />));
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('renders tables, strikethrough and task lists', () => {
    act(() =>
      root.render(
        <Markdown
          text={
            '**Games**\n| Game | Sessions | Note |\n|---|--:|:-:|\n| apex | 283 | a \\| b ~~old~~ |\n| bonfire |\n\n- [x] done\n- [ ] todo\n- [link](https://x.example)'
          }
        />,
      ),
    );
    expect(text('.gc-md > p')).toEqual(['Games']);
    expect(text('.gc-md-table th')).toEqual(['Game', 'Sessions', 'Note']);
    expect(text('.gc-md-table tbody tr:first-child td')).toEqual(['apex', '283', 'a | b old']);
    expect(text('.gc-md-table tbody tr:last-child td')).toEqual(['bonfire', '', '']);
    expect($$('.gc-md-table th').map((th) => (th as HTMLElement).style.textAlign)).toEqual(['', 'right', 'center']);
    expect($('td del').textContent).toBe('old');
    expect($$('.gc-md-task input').map((box) => (box as HTMLInputElement).checked)).toEqual([true, false]);
    expect(text('ul li')).toEqual(['done', 'todo', 'link']);
    act(() => root.render(<Markdown text={'a | b\nnot a delimiter\n\n| x |\n|---|---|'} />));
    expect($('table')).toBeNull();
  });

  it('sends with Enter, keeps Shift+Enter for a new line, ignores blank input', () => {
    const props = render({ state: fixture({ status: 'idle', queued: [] }) });
    type('   ');
    key({ key: 'Enter' });
    expect(props.onSend).not.toHaveBeenCalled();
    type('first line');
    key({ key: 'Enter', shiftKey: true });
    expect(props.onSend).not.toHaveBeenCalled();
    type('fix it\nplease');
    key({ key: 'Enter' });
    expect(props.onSend).toHaveBeenCalledWith('fix it\nplease');
    expect($<HTMLTextAreaElement>('textarea').value).toBe('');
    type('again');
    click(button('Send')!);
    expect(props.onSend).toHaveBeenLastCalledWith('again');
  });

  it('stops with the Stop button and Esc while running', () => {
    const props = render();
    click(button('Stop')!);
    key({ key: 'Escape' });
    expect(props.onStop).toHaveBeenCalledTimes(2);
    render({ state: fixture({ status: 'idle' }) });
    expect(button('Stop')).toBeUndefined();
  });

  it('does not send while disabled', () => {
    const props = render({ disabled: true });
    type('hello');
    key({ key: 'Enter' });
    expect(props.onSend).not.toHaveBeenCalled();
  });

  it('answers pending approvals through onApprove, or shows them as waiting', () => {
    render({ onApprove: undefined });
    expect($('.gc-waiting')?.textContent).toBe('Waiting for approval…');
    const onApprove = vi.fn();
    render({ onApprove });
    click(button('Approve')!);
    click(button('Deny')!);
    expect(onApprove.mock.calls).toEqual([
      ['ap-1', 'approve'],
      ['ap-1', 'deny'],
    ]);
    render({ onApprove, state: fixture({ approvals: [] }) });
    expect(button('Approve')).toBeUndefined();
    expect($('.gc-approval.gc-done')?.textContent).toContain('Not answered');
  });

  it('fills the host slots', () => {
    render({
      renderPrompt: (prompt) => (prompt.includes('clean') ? null : prompt.split('Operator: ')[1]),
      formatToolName: (name) => name.replace(/^mcp__ops__/, ''),
      renderAfterTurn: (turn, index) => (index === 0 ? <button>open turn {turn.id}</button> : null),
      renderFooter: () => <div className="host-card">Approve POST /queue?</div>,
      headerExtras: <button>New</button>,
      notices: [{ id: 'n1', afterTurn: 1, text: 'Switched to ops mode', tone: 'error' }],
    });
    expect(text('.gc-prompt')).toEqual(['fix the build']);
    expect(text('.gc-queued span')).toEqual(['⏸ then run the tests']);
    expect(text('.gc-tool-name')).toEqual(['Bash', 'queue']);
    expect(text('.gc-after-turn')).toEqual(['open turn 1']);
    expect($('.gc-footer-slot .host-card')).toBeTruthy();
    expect($('.gc-header').textContent).toContain('New');
    // Notices sit between turns: after the first one here.
    const order = $$('.gc-thread > *').map((el) => el.className);
    expect(order).toEqual(['gc-turn', 'gc-after-turn', 'gc-notice gc-err', 'gc-turn', 'gc-footer-slot']);
  });

  it('replaces or drops the header, sets the theme', () => {
    render({ header: <div className="mine">Console agent</div>, theme: 'dark' });
    expect($('.gc-header')).toBeNull();
    expect($('.mine').textContent).toBe('Console agent');
    expect($('.gc-chat').dataset.theme).toBe('dark');
    render({ header: null, theme: 'auto' });
    expect($('.gc-header')).toBeNull();
    expect($('.gc-chat').dataset.theme).toBeUndefined();
  });

  it('works before the host has a session', () => {
    const props = render({ state: null });
    expect($('.gc-empty-title').textContent).toBe('What should the agent work on?');
    expect($<HTMLTextAreaElement>('textarea').placeholder).toBe('Ask the agent to change something…');
    type('hello');
    key({ key: 'Enter' });
    expect(props.onSend).toHaveBeenCalledWith('hello');
    render({ state: undefined, emptyState: <p className="hint">Ask about the queue</p> });
    expect($('.hint').textContent).toBe('Ask about the queue');
  });

  it('folds the work of a turn with foldSteps, keeping the answer and open asks in view', () => {
    render({ foldSteps: true });
    const [done, live] = $$('.gc-turn');
    // Two tools and an edit fold; the answer stays out.
    expect(done!.querySelector('.gc-fold > summary')!.textContent).toBe('2 steps · errors');
    expect(done!.querySelectorAll('.gc-fold-body > *')).toHaveLength(3);
    expect(done!.querySelector('.gc-fold-body .gc-md')).toBeNull();
    expect(done!.querySelector('.gc-steps > .gc-md')!.textContent).toContain('Fixed two things');
    // A pending approval, an error and the streaming reply are all in view: nothing folds.
    expect(live!.querySelector('.gc-fold')).toBeNull();
    expect(live!.querySelector('.gc-approval:not(.gc-done)')).not.toBeNull();
    expect(live!.querySelector('.gc-error')!.textContent).toBe('rate limited');

    const state = fixture();
    state.turns[1]!.entries = [
      { kind: 'text', text: 'Looking', streaming: false },
      { kind: 'tool', id: 't3', name: 'mcp__ops__costs', input: {}, done: false },
      { kind: 'files', paths: ['/work/app/costs.json'] },
    ];
    render({ foldSteps: true, state, formatToolName: (name) => name.replace('mcp__ops__', '') });
    const summary = $$('.gc-turn')[1]!.querySelector('.gc-fold > summary')!;
    // Interim text and an edit fold too; the line names the tool still running.
    expect(summary.textContent).toBe('1 step · costs');
    expect($$('.gc-turn')[1]!.querySelectorAll('.gc-fold-body > *')).toHaveLength(3);
    expect($$('.gc-turn')[1]!.querySelector('.gc-steps > .gc-md')).toBeNull();
  });

  it('labels the send button by what a prompt will do while running', () => {
    render({ state: fixture({ canSteer: true }) });
    expect(button('Steer')).toBeTruthy();
    expect($<HTMLTextAreaElement>('textarea').placeholder).toBe('Add to the running task…');
  });
  it('shows a published artifact as a card and previews it in a sandboxed frame', () => {
    const artifact = {
      id: 'a'.repeat(32),
      name: 'report',
      title: 'Coverage report',
      kind: 'html' as const,
      mimeType: 'text/html; charset=utf-8',
      bytes: 2048,
      version: 2,
    };
    const image = { ...artifact, id: 'b'.repeat(32), title: 'Chart', kind: 'image' as const };
    const state = fixture();
    state.turns[0].entries.push({ kind: 'artifact', artifact }, { kind: 'artifact', artifact: image });
    // Folded steps keep artifacts in view.
    render({ state, foldSteps: true, artifactUrl: (a) => `/artifacts/${a.id}?v=${a.version}` });
    expect(text('.gc-artifact-title')).toEqual(['Coverage report', 'Chart']);
    expect($('.gc-artifact-meta').textContent).toBe('Page · 2.0 KB · v2');
    expect($('iframe')).toBeNull();
    act(() => $$('.gc-artifact button')[0].dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const frame = $<HTMLIFrameElement>('iframe.gc-artifact-view');
    expect(frame.getAttribute('src')).toBe(`/artifacts/${artifact.id}?v=2`);
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    act(() => $$('.gc-artifact button')[1].dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect($<HTMLImageElement>('img.gc-artifact-view').getAttribute('src')).toBe(`/artifacts/${image.id}?v=2`);
    expect($<HTMLAnchorElement>('.gc-artifact a').rel).toBe('noopener noreferrer');

    // No URL from the host: a card with nothing to open. A host renderer replaces the card.
    render({ state });
    expect($$('.gc-artifact button, .gc-artifact a')).toEqual([]);
    render({ state, renderArtifact: (a) => (a.kind === 'image' ? <b className="mine">{a.title}</b> : undefined) });
    expect(text('.mine')).toEqual(['Chart']);
    expect(text('.gc-artifact-title')).toEqual(['Coverage report']);
  });
  it('plays audio and video artifacts in the card', () => {
    const base = { name: 'n', title: 'Demo', mimeType: 'video/webm', bytes: 10, version: 1 };
    const state = fixture();
    state.turns[0].entries.push(
      { kind: 'artifact', artifact: { ...base, id: 'c'.repeat(32), kind: 'video' } },
      { kind: 'artifact', artifact: { ...base, id: 'd'.repeat(32), kind: 'audio', title: 'Beep' } },
    );
    render({ state, artifactUrl: (a) => `/artifacts/${a.id}` });
    expect(text('.gc-artifact-meta')).toEqual(['Video · 10 B', 'Audio · 10 B']);
    for (const button of $$('.gc-artifact button')) {
      act(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    }
    const video = $<HTMLVideoElement>('video.gc-artifact-view');
    expect(video.getAttribute('src')).toBe(`/artifacts/${'c'.repeat(32)}`);
    expect(video.hasAttribute('controls')).toBe(true);
    expect($('audio.gc-artifact-view').getAttribute('src')).toBe(`/artifacts/${'d'.repeat(32)}`);
    expect($('iframe')).toBeNull();
  });

  it('sends what a page submits to the agent only after the user confirms it', () => {
    const artifact = {
      id: 'e'.repeat(32),
      name: 'survey',
      title: 'Survey',
      kind: 'html' as const,
      mimeType: 'text/html; charset=utf-8',
      bytes: 100,
      version: 1,
    };
    const state = fixture();
    state.turns[0].entries.push({ kind: 'artifact', artifact });
    const props = render({ state, artifactUrl: (a) => `/artifacts/${a.id}` });
    const post = (data: unknown, source: unknown) =>
      act(() => {
        const event = new MessageEvent('message', { data });
        Object.defineProperty(event, 'source', { value: source });
        window.dispatchEvent(event);
      });
    const click = (label: string) =>
      act(() =>
        $$('.gc-artifact button')
          .find((button) => button.textContent === label)!
          .dispatchEvent(new MouseEvent('click', { bubbles: true })),
      );
    click('Open');
    const frame = $<HTMLIFrameElement>('iframe');
    const page = {};
    Object.defineProperty(frame, 'contentWindow', { value: page, configurable: true });

    // Another window, or another message: nothing.
    post({ genaicode: 'submit', data: { plan: 'b' } }, {});
    post({ type: 'resize' }, page);
    expect($('.gc-artifact-submit')).toBeNull();

    post({ genaicode: 'submit', data: { plan: 'b', seats: 3 } }, page);
    expect($('.gc-artifact-submit-data').textContent).toBe('{\n  "plan": "b",\n  "seats": 3\n}');
    expect(props.onSend).not.toHaveBeenCalled();
    click('Discard');
    expect($('.gc-artifact-submit')).toBeNull();
    expect(props.onSend).not.toHaveBeenCalled();

    post({ genaicode: 'submit', data: { plan: 'a' } }, page);
    click('Send to agent');
    expect(props.onSend).toHaveBeenCalledWith(artifactSubmission(artifact, { plan: 'a' }));
    expect($('.gc-artifact-submit')).toBeNull();

    // Too much for a message is refused, with no Send button.
    post({ genaicode: 'submit', data: 'x'.repeat(30_000) }, page);
    expect($('.gc-artifact-submit').textContent).toContain('more than fits');
    expect($$('.gc-artifact-submit button').map((button) => button.textContent)).toEqual(['Dismiss']);

    // The host handles it itself, or turns it off.
    const onArtifactSubmit = vi.fn();
    const mine = render({ state, artifactUrl: (a) => `/artifacts/${a.id}`, onArtifactSubmit });
    Object.defineProperty($('iframe'), 'contentWindow', { value: page, configurable: true });
    post({ genaicode: 'submit', data: [1, 2] }, page);
    click('Send to agent');
    expect(onArtifactSubmit).toHaveBeenCalledWith(artifact, [1, 2]);
    expect(mine.onSend).not.toHaveBeenCalled();
    render({ state, artifactUrl: (a) => `/artifacts/${a.id}`, onArtifactSubmit: null });
    post({ genaicode: 'submit', data: 1 }, page);
    expect($('.gc-artifact-submit')).toBeNull();
  });

  it('words a submission so that its data cannot pass for anything else', () => {
    const message = artifactSubmission({ title: 'Survey', name: 'survey' }, { note: 'a ``` b' });
    expect(message).toContain('Submitted from the artifact "Survey" (name: survey)');
    expect(message).toContain('````json\n{\n  "note": "a ``` b"\n}\n````');
    expect(artifactSubmission({ title: 'T', name: 'n' }, undefined)).toContain('```json\nnull\n```');
  });

  it('lets the microphone go when the composer unmounts while the browser asks for it', async () => {
    const stop = vi.fn();
    let grant!: (stream: unknown) => void;
    const asked = new Promise((resolve) => (grant = resolve));
    const start = vi.fn();
    vi.stubGlobal(
      'MediaRecorder',
      class {
        state = 'inactive';
        mimeType = 'audio/webm';
        addEventListener() {}
        start = start;
        stop() {}
      },
    );
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(() => asked) },
    });
    try {
      render({ state: fixture({ status: 'idle' }), attachments: { voice: true } });
      act(() => $('[aria-label="Record a voice message"]').click());
      act(() => root.unmount());
      grant({ getTracks: () => [{ stop }] });
      await act(async () => {
        await asked;
        await Promise.resolve();
      });
      expect(stop).toHaveBeenCalledTimes(1);
      expect(start).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      Reflect.deleteProperty(navigator, 'mediaDevices');
      root = createRoot(container);
    }
  });

  it('lets the microphone go when the recorder will not start', async () => {
    const stop = vi.fn();
    vi.stubGlobal(
      'MediaRecorder',
      class {
        constructor() {
          throw new Error('no codec');
        }
      },
    );
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }] })) },
    });
    try {
      render({ state: fixture({ status: 'idle' }), attachments: { voice: true } });
      await act(async () => {
        $('[aria-label="Record a voice message"]').click();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(stop).toHaveBeenCalledTimes(1);
      expect(container.textContent).toContain('The microphone is not available: no codec');
    } finally {
      vi.unstubAllGlobals();
      Reflect.deleteProperty(navigator, 'mediaDevices');
    }
  });

  it('stops a recording when the host turns voice messages off', async () => {
    const stopTrack = vi.fn();
    const stopRecorder = vi.fn();
    vi.stubGlobal(
      'MediaRecorder',
      class {
        state = 'inactive';
        mimeType = 'audio/webm';
        addEventListener() {}
        start() {
          this.state = 'recording';
        }
        stop = stopRecorder;
      },
    );
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] })) },
    });
    try {
      const props = render({ state: fixture({ status: 'idle' }), attachments: { voice: true } });
      await act(async () => {
        $('[aria-label="Record a voice message"]').click();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect($('[aria-label="Stop recording"]')).not.toBeNull();
      render({ ...props, attachments: { voice: false } });
      expect(stopRecorder).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
      Reflect.deleteProperty(navigator, 'mediaDevices');
    }
  });

  it('drops pending files when the host stops taking attachments', () => {
    const props = render({ state: fixture({ status: 'idle' }), attachments: {} });
    const note = new File(['hello'], 'note.txt', { type: 'text/plain' });
    const paste = Object.assign(new Event('paste', { bubbles: true, cancelable: true }), {
      clipboardData: { files: [note] },
    });
    act(() => {
      $('textarea').dispatchEvent(paste);
    });
    expect($('.gc-attachments').textContent).toContain('note.txt');
    render({ ...props, attachments: undefined });
    expect($('.gc-attachments')).toBeNull();
    type('just text');
    click(button('Send')!);
    const sent = (props.onSend as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(sent[0]).toBe('just text');
    expect(sent[1] ?? []).toEqual([]);
  });
});
