// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionState } from '../agents/session.js';
import { AgentChat, Markdown, type AgentChatProps } from '../react.js';

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
    expect(text('.gc-error')).toEqual(['rate limited']);
    expect($$('.gc-md')[1].className).toContain('gc-caret');
    expect(text('.gc-queued span')).toEqual(['⏸ CONTEXT: x\n\nOperator: then run the tests']);
    expect($('.gc-header').textContent).toContain('sonnet');
    expect($('.gc-header').textContent).toContain('…89abcdef');
    expect($('.gc-header').textContent).toContain('1.5k tokens · $0.012');
    expect($('.gc-chat').dataset.status).toBe('running');
    expect(button('Queue')).toBeTruthy();
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
    act(() => root.render(<Markdown text={`${'>'.repeat(50_000)} deep`} />));
    expect($$('blockquote')).toHaveLength(8);
    expect($('.gc-md').textContent).toContain('deep');
    const started = Date.now();
    act(() => root.render(<Markdown text={`${'['.repeat(20_000)}${' '.repeat(20_000)}x\n${'- '.repeat(10_000)}`} />));
    expect(Date.now() - started).toBeLessThan(1000);
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

  it('labels the send button by what a prompt will do while running', () => {
    render({ state: fixture({ canSteer: true }) });
    expect(button('Steer')).toBeTruthy();
    expect($<HTMLTextAreaElement>('textarea').placeholder).toBe('Add to the running task…');
  });
});
