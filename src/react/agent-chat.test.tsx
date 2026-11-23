// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionState } from '../agents/session.js';
import {
  AgentChat,
  ArtifactPanel,
  artifactSubmission,
  Markdown,
  parseFileTarget,
  type AgentChatProps,
} from '../react.js';

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
  it('puts pack approvals in one queue and scopes diff and discard to the selected worker', async () => {
    const state = fixture();
    const turn = state.turns[1];
    const request = { ...state.approvals[0], id: 't1:a', subtaskId: 't1' };
    state.approvals = [request];
    turn.entries = [{ kind: 'approval', request }];
    turn.pack = {
      lead: 'claude',
      maxParallel: 4,
      interactive: true,
      tasks: [
        {
          id: 't1',
          agent: 'codex',
          cwd: '/work/a',
          prompt: 'Write CSV',
          mode: 'worktree',
          status: 'running',
          canSteer: true,
          state: 'unmerged',
        },
        {
          id: 't2',
          agent: 'gemini',
          cwd: '/work/b',
          prompt: 'Write docs',
          mode: 'worktree',
          status: 'completed',
          state: 'unmerged',
        },
      ],
    };
    const onPackAction = vi.fn(async () => '+added');
    const onApprove = vi.fn();
    const onAutoApprove = vi.fn();
    render({ state, onApprove, onAutoApprove, onPackAction });
    expect($$('.gc-approval:not(.gc-done)')).toHaveLength(1);
    click(button('Approvals · 1')!);
    click(button('Auto-approve all')!);
    expect(onAutoApprove).toHaveBeenCalledTimes(1);
    click(button('Approve')!);
    expect(onApprove).toHaveBeenCalledWith('t1:a', 'approve');
    click($$('.gc-pack-list button')[1]);
    await act(async () => {
      button('Show diff')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect($('.gc-pack-diff').textContent).toBe('+added');
    expect(onPackAction).toHaveBeenCalledWith(turn.id, 't2', { type: 'diff' });
    click(button('Discard')!);
    click(button('Cancel')!);
    expect(onPackAction).toHaveBeenCalledTimes(1);
    click(button('Discard')!);
    await act(async () => {
      (button('Confirm discard') as HTMLElement).click();
    });
    expect(onPackAction).toHaveBeenCalledWith(turn.id, 't2', { type: 'discard' });
  });
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

    render({ state: fixture({ mode: 'plan' }) });
    expect(text('.gc-header .gc-chip')).toContain('plan');
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

  it('renders angle-delimited web links and keeps unsupported schemes as text', () => {
    act(() =>
      root.render(
        <Markdown text="[docs](<https://example.org/a_(b)>), [mail](<mailto:a@example.org>) or [bad](<javascript:alert(1)>)." />,
      ),
    );
    expect(text('a')).toEqual(['docs', 'mail']);
    expect($$('a').map((a) => a.getAttribute('href'))).toEqual(['https://example.org/a_(b)', 'mailto:a@example.org']);
    expect($('.gc-md').textContent).toBe('docs, mail or [bad](<javascript:alert(1)>).');
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

  it('takes the message back when the host says it was not sent', async () => {
    const onSend = vi.fn<AgentChatProps['onSend']>().mockReturnValueOnce(Promise.resolve(false));
    render({ state: fixture({ status: 'idle', queued: [] }), onSend });
    type('keep me');
    key({ key: 'Enter' });
    expect($<HTMLTextAreaElement>('textarea').value).toBe('');
    await act(async () => {});
    expect($<HTMLTextAreaElement>('textarea').value).toBe('keep me');
    // A message started meanwhile is not mixed with the one that failed.
    onSend.mockReturnValueOnce(Promise.resolve(false));
    key({ key: 'Enter' });
    type('newer');
    await act(async () => {});
    expect($<HTMLTextAreaElement>('textarea').value).toBe('newer');
    // One that left stays gone.
    onSend.mockReturnValueOnce(Promise.resolve(true));
    key({ key: 'Enter' });
    await act(async () => {});
    expect(onSend).toHaveBeenCalledTimes(3);
    expect($<HTMLTextAreaElement>('textarea').value).toBe('');
  });

  it('shows what an edit changed, line by line', () => {
    const tool = (input: unknown, output?: string) =>
      ({ kind: 'tool', name: 'Edit', input, output, done: true }) as const;
    render({
      state: fixture({
        turns: [
          {
            id: 1,
            agent: 'claude',
            prompt: 'p',
            startedAt: 1,
            entries: [
              tool({ file_path: '/w/a.ts', old_string: 'a\nb\nc', new_string: 'a\nB\nB2\nc' }),
              tool({ command: 'ls' }, 'a.ts'),
            ],
          },
        ],
      }),
    });
    const steps = document.querySelectorAll('.gc-tool');
    expect(steps[0].querySelector('.gc-diff-stat')?.textContent).toBe('+2−1');
    expect(
      Array.from(steps[0].querySelectorAll('.gc-diff > div')).map(
        (line) => `${line.getAttribute('data-sign')}${line.textContent}`,
      ),
    ).toEqual([' a', '-b', '+B', '+B2', ' c']);
    // Nothing to say after an edit that went through; a command keeps its output.
    expect(steps[0].querySelector('pre')).toBeNull();
    expect(steps[1].querySelector('.gc-diff')).toBeNull();
    expect(steps[1].querySelector('pre')?.textContent).toBe('a.ts');
  });

  it('makes the paths of edited and read files buttons when the host can open them', () => {
    const onOpenFile = vi.fn();
    const state = fixture({
      turns: [
        {
          id: 1,
          agent: 'claude',
          prompt: 'p',
          startedAt: 1,
          entries: [
            { kind: 'tool', name: 'Read', input: { file_path: '/w/a.ts' }, output: 'x', done: true },
            { kind: 'tool', name: 'Grep', input: { pattern: 'x', path: '/w' }, output: 'x', done: true },
            { kind: 'files', paths: ['/w/b.ts'] },
          ],
        },
      ],
    });
    render({ state });
    expect(document.querySelector('.gc-open-file')).toBeNull();
    render({ state, onOpenFile });
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.gc-open-file'));
    expect(buttons.map((button) => button.textContent)).toEqual(['Open /w/a.ts', '/w/b.ts']);
    act(() => buttons[1].click());
    expect(onOpenFile).toHaveBeenCalledWith('/w/b.ts');
  });

  it('shows the diff an agent reports with its changed files, and opens a file linked in a reply', () => {
    const onOpenFile = vi.fn();
    render({
      onOpenFile,
      state: fixture({
        turns: [
          {
            id: 1,
            agent: 'codex',
            prompt: 'p',
            startedAt: 1,
            entries: [
              {
                kind: 'files',
                paths: ['/w/a.txt'],
                diff: '--- /w/a.txt\n+++ /w/a.txt\n@@ -1,2 +1,2 @@\n-first\n+hello\n second',
              },
              {
                kind: 'text',
                text: 'Changed [a.txt](/w/a.txt:1) and see [docs](https://example.com).',
                streaming: false,
              },
            ],
          },
        ],
      }),
    });
    const edited = $('.gc-edited');
    expect(edited.querySelector('.gc-diff-stat')?.textContent).toBe('+1−1');
    expect(
      Array.from(edited.querySelectorAll('.gc-diff > div[data-sign="+"], .gc-diff > div[data-sign="-"]')).map(
        (line) => line.textContent,
      ),
    ).toEqual(['first', 'hello']);
    const link = $<HTMLButtonElement>('.gc-file-link');
    expect(link.textContent).toBe('a.txt');
    act(() => link.click());
    expect(onOpenFile).toHaveBeenCalledWith('/w/a.txt', { line: 1 });
    expect(document.querySelector('a[href="https://example.com"]')).not.toBeNull();
  });

  it('puts the host controls in a row under the field, with the attach button', () => {
    render({
      state: fixture({ status: 'idle', queued: [] }),
      composerExtras: <select aria-label="Agent" />,
      attachments: {},
    });
    // The field keeps the text and Send only.
    const box = $('.gc-box');
    expect(box.classList.contains('gc-stacked')).toBe(false);
    expect(Array.from(box.children).map((child) => child.tagName)).toEqual(['TEXTAREA', 'BUTTON']);
    const under = $('.gc-under');
    expect(box.nextElementSibling).toBe(under);
    expect(under.querySelector('[aria-label="Attach files"]')).not.toBeNull();
    expect(under.querySelector('select')).not.toBeNull();
  });

  it('offers the host commands while the message starts one, and completes the chosen one', () => {
    const completions = [
      { name: '/model', args: '[id]', help: 'set the model' },
      { name: '/new', help: 'start again' },
      { name: '/help' },
    ];
    const props = render({ state: fixture({ status: 'idle', queued: [] }), completions });
    const offered = () => text('.gc-completions li b');
    const value = () => $<HTMLTextAreaElement>('textarea').value;
    expect($('.gc-completions')).toBeNull();
    type('/');
    expect(offered()).toEqual(['/model', '/new', '/help']);
    expect($('.gc-completions li[aria-selected="true"]').textContent).toContain('/model');
    // Arrows go round, keeping the chosen one in view. Enter completes instead of sending.
    const shown: string[] = [];
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(function (this: HTMLElement) {
      shown.push(this.querySelector('b')?.textContent ?? '');
    });
    key({ key: 'ArrowUp' });
    expect(shown.at(-1)).toBe('/help');
    // The box says which list it drives and which option is chosen.
    const box = $('textarea');
    expect(box.getAttribute('aria-controls')).toBe($('.gc-completions').id);
    expect(box.getAttribute('aria-activedescendant')).toBe($('.gc-completions li[aria-selected="true"]').id);
    expect(box.getAttribute('aria-expanded')).toBe('true');
    scroll.mockRestore();
    key({ key: 'ArrowDown' });
    key({ key: 'Enter' });
    expect(value()).toBe('/model ');
    expect(props.onSend).not.toHaveBeenCalled();
    expect($('.gc-completions')).toBeNull();
    type('/n');
    expect(offered()).toEqual(['/new']);
    key({ key: 'Tab' });
    expect(value()).toBe('/new');
    // A whole command is sent as typed.
    key({ key: 'Enter' });
    expect(props.onSend).toHaveBeenCalledWith('/new');
    // Escape closes the list and does not stop anything; a click completes.
    type('/h');
    key({ key: 'Escape' });
    expect($('.gc-completions')).toBeNull();
    expect(props.onStop).not.toHaveBeenCalled();
    // Escape closed that list only: the same start typed again offers it again.
    type('');
    type('/h');
    expect(offered()).toEqual(['/help']);
    type('/he');
    act(() => {
      $('.gc-completions li').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    });
    expect(value()).toBe('/help');
    // A whole command that also starts a longer one is sent as typed.
    render({ state: fixture({ status: 'idle', queued: [] }), completions: [{ name: '/foo' }, { name: '/foobar' }] });
    type('/foo');
    expect($('.gc-completions')).toBeNull();
    render({ state: fixture({ status: 'idle', queued: [] }), completions });
    // Not a command: nothing is offered, and nothing without the host's list.
    type('fix /model');
    expect($('.gc-completions')).toBeNull();
    render({ state: fixture({ status: 'idle', queued: [] }) });
    type('/');
    expect($('.gc-completions')).toBeNull();
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

  it('replaces raw error entries when renderFailure returns custom content', () => {
    const state = fixture({
      turns: [
        {
          id: 1,
          agent: 'codex',
          prompt: 'hello',
          entries: [{ kind: 'error', message: 'RAW 401 stderr output' }],
          startedAt: 1000,
          endedAt: 1200,
          result: {
            status: 'failed',
            ok: false,
            exitCode: 1,
            signal: null,
            error: 'RAW 401 stderr output',
            failure: { kind: 'auth' },
          },
        },
      ],
    });
    render({
      state,
      renderFailure: (turn) =>
        turn.result?.failure?.kind === 'auth' ? (
          <div className="custom-signin">Sign in to {turn.agent}</div>
        ) : undefined,
    });
    expect(container.textContent).toContain('Sign in to codex');
    expect(container.textContent).not.toContain('RAW 401 stderr output');
    expect(container.textContent).toContain('sign-in required · codex');
  });

  it('shows an agent question as a card and sends the answers', () => {
    const request = {
      id: 'q-1',
      kind: 'question' as const,
      summary: 'Which color?',
      questions: [
        {
          id: 'color',
          header: 'Color',
          question: 'Which color?',
          options: [{ label: 'Red', description: 'Warm' }, { label: 'Blue' }],
          freeText: true,
        },
      ],
    };
    const asking = (extra: object = {}) => {
      const state = fixture({ approvals: [request] });
      state.turns.at(-1)!.entries.push({ kind: 'approval', request, ...extra });
      return state;
    };
    const onAnswer = vi.fn();
    const onApprove = vi.fn();
    render({ state: asking(), onAnswer, onApprove });
    expect($('.gc-question legend')?.textContent).toBe('ColorWhich color?');
    expect(text('.gc-option-label')).toEqual(['Red', 'Blue']);
    expect(button('Approve')).toBeUndefined();
    // One question with one choice: a click answers.
    click($$('.gc-option')[1]!);
    expect(onAnswer).toHaveBeenLastCalledWith('q-1', { color: ['Blue'] });
    click(button('Skip')!);
    expect(onApprove).toHaveBeenLastCalledWith('q-1', 'deny');

    // An answer of one's own goes with Send.
    const own = $<HTMLInputElement>('.gc-question-own');
    expect(button('Send answer')!.hasAttribute('disabled')).toBe(true);
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(own, 'Green');
      own.dispatchEvent(new Event('input', { bubbles: true }));
    });
    click(button('Send answer')!);
    expect(onAnswer).toHaveBeenLastCalledWith('q-1', { color: ['Green'] });

    // Several questions, one of them with several choices: nothing goes before Send.
    const many = {
      ...request,
      questions: [
        request.questions[0]!,
        {
          id: 'sizes',
          question: 'Which sizes?',
          options: [{ label: 'S' }, { label: 'M' }, { label: 'L' }],
          multiple: true,
        },
      ],
    };
    const state = fixture({ approvals: [many] });
    state.turns.at(-1)!.entries.push({ kind: 'approval', request: many });
    onAnswer.mockClear();
    act(() => root.unmount());
    root = createRoot(container);
    render({ state, onAnswer, onApprove });
    click($$('.gc-option')[0]!);
    click($$('.gc-option')[2]!);
    click($$('.gc-option')[4]!);
    click($$('.gc-option')[2]!);
    expect(onAnswer).not.toHaveBeenCalled();
    expect($$('.gc-option.gc-on').map((el) => el.textContent)).toEqual(['RedWarm', 'L']);
    click(button('Send answers')!);
    expect(onAnswer).toHaveBeenLastCalledWith('q-1', { color: ['Red'], sizes: ['L'] });

    // Without onAnswer the options are there, disabled, and Skip still declines.
    render({ state: asking(), onApprove });
    expect($<HTMLFieldSetElement>('.gc-question fieldset').disabled).toBe(true);
    expect(button('Send answer')).toBeUndefined();
    click(button('Skip')!);
    expect(onApprove).toHaveBeenLastCalledWith('q-1', 'deny');
    render({ state: asking(), onApprove: undefined });
    expect($('.gc-question .gc-waiting')?.textContent).toBe('Waiting for an answer…');

    // Answered, skipped, and left open by a turn that ended.
    const done = (extra: object) => {
      const ended = fixture({ approvals: [] });
      ended.turns.at(-1)!.entries.push({ kind: 'approval', request, ...extra });
      render({ state: ended, onAnswer, onApprove });
      return $$('.gc-approval.gc-done').at(-1)!.textContent;
    };
    expect(done({ decision: 'approve', answers: { color: ['Blue'] } })).toBe('✓ Answered: Color: Blue');
    expect(done({ decision: 'deny' })).toBe('– Skipped: Which color?');
    expect(done({})).toBe('– Not answered: Which color?');
  });

  it('answers pending approvals through onApprove, or shows them as waiting', () => {
    const onAutoApprove = vi.fn();
    render({ onApprove: undefined, onAutoApprove });
    expect($('.gc-waiting')?.textContent).toBe('Waiting for approval…');
    expect(button('Auto-approve all')).toBeUndefined();
    const onApprove = vi.fn();
    render({ onApprove });
    expect(button('Auto-approve all')).toBeUndefined();
    click(button('Approve')!);
    click(button('Deny')!);
    expect(onApprove.mock.calls).toEqual([
      ['ap-1', 'approve'],
      ['ap-1', 'deny'],
    ]);
    render({ onApprove, onAutoApprove });
    click(button('Auto-approve all')!);
    expect(onAutoApprove).toHaveBeenCalledTimes(1);
    expect(onApprove).toHaveBeenCalledTimes(2);
    render({ onApprove, onAutoApprove, state: fixture({ approvals: [] }) });
    expect(button('Approve')).toBeUndefined();
    expect(button('Auto-approve all')).toBeUndefined();
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

  it('renders live cross-session relay cards with status, collapsible prompt, and Markdown replies', () => {
    const startedAt = Date.now() - 42_000;
    render({
      formatToolName: (name) => (name === 'Bash' ? 'Shell' : name),
      notices: [
        {
          id: 'r1',
          afterTurn: 1,
          text: 'fallback',
          relay: {
            agent: 'claude',
            sessionId: 'da398a6c-9f2e-48a6-b766-b329efe401b3',
            title: 'Merge PR #296',
            cwd: '/work/genaicode',
            prompt: 'Check CI and merge PR #296\nNo admin bypass.',
            status: 'answered',
            startedAt,
            endedAt: startedAt + 42_000,
            reply:
              '[PR #296](https://github.com/gtanczyk/genaicode/pull/296) merged as `2be53b1`.\n\n- **Checks:** all green',
          },
        },
        {
          id: 'r2',
          afterTurn: 1,
          text: 'fallback',
          relay: {
            agent: 'claude',
            sessionId: 'ab12cd34',
            cwd: '/work/genaicode',
            prompt: 'Check release PR',
            status: 'working',
            startedAt: Date.now() - 5_000,
            tool: 'Bash',
          },
        },
        {
          id: 'r3',
          afterTurn: 1,
          text: 'fallback',
          relay: {
            agent: 'codex',
            sessionId: 'ff99ee88',
            cwd: '/work/genaicode',
            prompt: 'Run npm run check',
            status: 'queued',
            startedAt: Date.now(),
          },
        },
        {
          id: 'r4',
          afterTurn: 1,
          text: 'fallback',
          tone: 'error',
          relay: {
            agent: 'claude',
            sessionId: 'deadbeef',
            cwd: '/work/genaicode',
            prompt: 'Inspect logs',
            status: 'failed',
            startedAt,
            endedAt: startedAt + 1_000,
            error: 'Session could not be found.',
          },
        },
      ],
    });
    const cards = $$('.gc-relay');
    expect(cards).toHaveLength(4);

    // Answered: avatar, project chip, duration pill, collapsible sent prompt, rendered Markdown.
    const answered = cards[0]!;
    expect(answered.querySelector('.gc-relay-avatar')?.textContent).toBe('cl');
    expect(answered.querySelector('.gc-relay-project')?.textContent).toBe('genaicode');
    expect(answered.querySelector('.gc-relay-status')?.textContent).toBe('Answered · 42s');
    expect(answered.querySelector('.gc-relay-sent-preview')?.textContent).toBe('Check CI and merge PR #296');
    expect(answered.querySelector('.gc-relay-sent-full')?.textContent).toContain('No admin bypass.');
    expect(answered.querySelector('.gc-relay-body a')?.getAttribute('href')).toBe(
      'https://github.com/gtanczyk/genaicode/pull/296',
    );
    expect(answered.querySelector('.gc-relay-body code')?.textContent).toBe('2be53b1');
    expect(answered.querySelector('.gc-relay-body strong')?.textContent).toBe('Checks:');

    // Working: spinner + formatted tool name.
    const working = cards[1]!;
    expect(working.querySelector('.gc-relay-status .gc-spin')).toBeTruthy();
    expect(working.querySelector('.gc-relay-status')?.textContent).toContain('Working ·');
    expect(working.querySelector('.gc-relay-live')?.textContent).toBe('NowShell');

    // Queued: waiting hint.
    const queued = cards[2]!;
    expect(queued.querySelector('.gc-relay-status')?.textContent).toBe('Queued');
    expect(queued.querySelector('.gc-relay-live')?.textContent).toContain('Waiting for its current turn');

    // Failed: error alert.
    const failed = cards[3]!;
    expect(failed.querySelector('.gc-relay-status')?.textContent).toBe('Failed');
    expect(failed.querySelector('[role="alert"]')?.textContent).toBe('Session could not be found.');
  });

  it('scopes Markdown file links and local images in relay replies to the target project and active workspace', () => {
    const onOpenFile = vi.fn();
    const imageUrl = vi.fn((path: string) =>
      path.endsWith('.png') ? `/files/${encodeURIComponent(path)}` : undefined,
    );
    render({
      onOpenFile,
      imageUrl,
      state: fixture({ cwd: '/work/app' }),
      notices: [
        {
          id: 'same-sub',
          afterTurn: 1,
          text: 'fallback',
          relay: {
            agent: 'claude',
            sessionId: 's1',
            cwd: '/work/app/packages/ui',
            prompt: 'Check file',
            status: 'answered',
            startedAt: 1000,
            endedAt: 2000,
            reply: 'See [button](./src/button.tsx) and [outside](../../../other/secret.ts).',
          },
        },
        {
          id: 'foreign',
          afterTurn: 1,
          text: 'fallback',
          relay: {
            agent: 'codex',
            sessionId: 's2',
            cwd: '/work/other',
            prompt: 'Check result',
            status: 'answered',
            startedAt: 1000,
            endedAt: 2000,
            reply:
              'See [result](./src/result.ts#L12-L20), [app](/work/app/src/index.ts), ![shot](./shot.png), and [escape](../../etc/passwd).',
          },
        },
      ],
    });
    const [inWorkspace, foreign] = $$('.gc-relay');
    // Subdirectory link resolves against relay.cwd and opens inside /work/app.
    const inButton = inWorkspace!.querySelector<HTMLButtonElement>('button.gc-file-link');
    expect(inButton?.getAttribute('data-gc-file')).toBe('/work/app/packages/ui/src/button.tsx');
    act(() => inButton!.click());
    expect(onOpenFile).toHaveBeenCalledWith('/work/app/packages/ui/src/button.tsx');
    // Traversal escaping both relay.cwd and /work/app renders as plain non-clickable text.
    expect(inWorkspace!.querySelectorAll('button.gc-file-link')).toHaveLength(1);
    expect(inWorkspace!.querySelector('span.gc-file-link')?.getAttribute('title')).toBe('/work/other/secret.ts');

    // Foreign project links resolve against relay.cwd (never the active workspace) and preserve line ranges.
    const foreignButtons = Array.from(foreign!.querySelectorAll<HTMLButtonElement>('button.gc-file-link'));
    expect(foreignButtons.map((el) => el.getAttribute('data-gc-file'))).toEqual([
      '/work/other/src/result.ts',
      '/work/app/src/index.ts',
    ]);
    act(() => foreignButtons[0]!.click());
    expect(onOpenFile).toHaveBeenCalledWith('/work/other/src/result.ts', { line: 12, endLine: 20 });

    // Local image in the foreign relay resolves against relay.cwd too.
    const imgBtn = foreign!.querySelector<HTMLButtonElement>('button.gc-md-image-btn');
    expect(imgBtn?.getAttribute('data-gc-file')).toBe('/work/other/shot.png');
    expect(imageUrl).toHaveBeenCalledWith('/work/other/shot.png');

    // Escaped path outside both relay.cwd and state.cwd stays non-clickable.
    const escaped = foreign!.querySelector('span.gc-file-link');
    expect(escaped?.getAttribute('title')).toBe('/etc/passwd');
    act(() => (escaped as HTMLElement).click());
    expect(onOpenFile).toHaveBeenCalledTimes(2);
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

  it('passes file-link line and range positions to onOpenFile and parses targets cleanly', () => {
    expect(parseFileTarget('/w/a.ts:12')).toEqual({ path: '/w/a.ts', position: { line: 12 } });
    expect(parseFileTarget('/w/a.ts:12:3')).toEqual({ path: '/w/a.ts', position: { line: 12, column: 3 } });
    expect(parseFileTarget('./src/b.ts#L12-L20')).toEqual({ path: './src/b.ts', position: { line: 12, endLine: 20 } });
    expect(parseFileTarget('C:\\work\\c.ts:5:2')).toEqual({ path: 'C:\\work\\c.ts', position: { line: 5, column: 2 } });
    expect(parseFileTarget('/w/plain.ts')).toEqual({ path: '/w/plain.ts' });

    const onOpenFile = vi.fn();
    const state = fixture({
      turns: [
        {
          id: 1,
          agent: 'claude',
          prompt: 'p',
          startedAt: 1,
          entries: [
            {
              kind: 'text',
              text: 'See [one](/w/a.ts:12:3), [range](<./My Project (draft)/b.ts#L5-L9>) and [podroz-po-calym-swiecie](</work/podroz-po-calym-swiecie>).',
              streaming: false,
            },
          ],
        },
      ],
    });
    render({ state, onOpenFile });
    const links = $$('.gc-file-link');
    expect(links).toHaveLength(3);
    expect(links.map((element) => element.textContent)).toEqual(['one', 'range', 'podroz-po-calym-swiecie']);
    click(links[0]!);
    click(links[1]!);
    click(links[2]!);
    expect(onOpenFile.mock.calls).toEqual([
      ['/w/a.ts', { line: 12, column: 3 }],
      ['./My Project (draft)/b.ts', { line: 5, endLine: 9 }],
      ['/work/podroz-po-calym-swiecie'],
    ]);
  });

  it('renders Markdown images safely: local thumbnails, click-to-load remote chips, no data: URIs, linear time', () => {
    const onOpenFile = vi.fn();
    const state = fixture({
      turns: [
        {
          id: 1,
          agent: 'claude',
          prompt: 'p',
          startedAt: 1,
          entries: [
            {
              kind: 'text',
              text: [
                '![Chart](/work/chart.png)',
                '![Unresolved](./missing.png)',
                '![Tracker](https://cdn.example/pixel.png?secret=1)',
                '![Inline](data:image/svg+xml,<svg/>)',
                '![Nested](https://a.example/x.png) [![Inner](https://b.example/y.png)](https://outer.example)',
              ].join('\n\n'),
              streaming: false,
            },
          ],
        },
      ],
    });
    render({
      state,
      onOpenFile,
      imageUrl: (path) => (path === '/work/chart.png' ? '/files/deadbeef' : undefined),
    });

    // Local resolved image becomes a clickable thumbnail with lazy + no-referrer.
    const thumb = $<HTMLImageElement>('.gc-md-image-btn img.gc-md-image');
    expect(thumb.getAttribute('src')).toBe('/files/deadbeef');
    expect(thumb.getAttribute('loading')).toBe('lazy');
    expect(thumb.getAttribute('referrerpolicy')).toBe('no-referrer');
    click($('.gc-md-image-btn'));
    expect(onOpenFile).toHaveBeenCalledWith('/work/chart.png');

    // Unresolved local image falls back to a file link.
    const fallback = $<HTMLButtonElement>('.gc-file-link[data-gc-file="./missing.png"]');
    expect(fallback.textContent).toBe('Unresolved');

    // Remote images NEVER render an <img> before clicking Load.
    expect($$('img').map((el) => el.getAttribute('src'))).toEqual(['/files/deadbeef']);
    const chips = $$('.gc-md-image-chip');
    expect(chips.length).toBe(3);
    expect(chips[0]!.textContent).toContain('Image: cdn.example/pixel.png');
    expect(chips[0]!.textContent).not.toContain('secret=1');
    // No nested links around images.
    expect($$('a a')).toHaveLength(0);

    // Clicking Load loads that specific remote image with no-referrer.
    click(chips[0]!.querySelector('button.gc-md-image-load')!);
    expect($$('img').map((el) => el.getAttribute('src'))).toEqual([
      '/files/deadbeef',
      'https://cdn.example/pixel.png?secret=1',
    ]);

    // data: URI is never rendered as an image; kept as plain text.
    expect(container.textContent).toContain('![Inline](data:image/svg+xml,<svg/>)');
    expect($$('img[src^="data:"]')).toHaveLength(0);

    // Clicking Load authorizes only that exact URL: replacing it at the same position requires a fresh click.
    act(() => root.render(<Markdown text="![First](https://img.example/one.png)" />));
    click($('button.gc-md-image-load'));
    expect($<HTMLImageElement>('img.gc-md-image').getAttribute('src')).toBe('https://img.example/one.png');
    act(() => root.render(<Markdown text="![Second](https://img.example/two.png)" />));
    expect($$('img')).toHaveLength(0);
    expect($('.gc-md-image-chip').textContent).toContain('img.example/two.png');

    // remoteImages="load" loads remote images immediately.
    act(() => root.render(<Markdown text="![Photo](https://img.example/pic.jpg)" remoteImages="load" />));
    expect($<HTMLImageElement>('img.gc-md-image').getAttribute('src')).toBe('https://img.example/pic.jpg');

    // Bounded regex stays fast on hostile unclosed image tokens.
    const started = Date.now();
    act(() => root.render(<Markdown text={`${'!['.repeat(20_000)}${'('.repeat(20_000)}`} />));
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('delegates artifact Open to onOpenArtifact and exports a working ArtifactPanel', () => {
    const v1 = {
      id: 'a'.repeat(32),
      name: 'survey',
      title: 'Survey',
      kind: 'html' as const,
      mimeType: 'text/html; charset=utf-8',
      bytes: 120,
      version: 1,
    };
    const v2 = { ...v1, bytes: 180, version: 2 };
    const state = fixture();
    state.turns[0].entries.push({ kind: 'artifact', artifact: v2 });
    const onOpenArtifact = vi.fn();
    render({ state, artifactUrl: (a) => `/artifacts/${a.id}?v=${a.version}`, onOpenArtifact });
    click($$('.gc-artifact button')[0]!);
    expect(onOpenArtifact).toHaveBeenCalledWith(v2);
    // Inline iframe is NOT expanded when onOpenArtifact is set.
    expect($('iframe')).toBeNull();

    // Exported <ArtifactPanel>: version switching, full size Esc order, and submit confirmation.
    const onSelectVersion = vi.fn();
    const onSubmit = vi.fn();
    const onClose = vi.fn();
    act(() =>
      root.render(
        <ArtifactPanel
          artifact={v2}
          versions={[v1, v2]}
          url={`/artifacts/${v2.id}?v=2`}
          onSelectVersion={onSelectVersion}
          onSubmit={onSubmit}
          onClose={onClose}
        />,
      ),
    );
    const select = $<HTMLSelectElement>('select[aria-label="Version"]');
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['2', '1']);
    act(() => {
      select.value = '1';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onSelectVersion).toHaveBeenCalledWith(v1);

    // Esc exits full size first, then closes panel.
    click(button('Full size')!);
    expect($('.gc-panel').getAttribute('data-full-size')).toBe('true');
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect($('.gc-panel').getAttribute('data-full-size')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    // Submit flow stays attached to the panel's frame.
    const frame = $<HTMLIFrameElement>('iframe.gc-panel-frame');
    const page = {};
    Object.defineProperty(frame, 'contentWindow', { value: page, configurable: true });
    act(() => {
      const event = new MessageEvent('message', { data: { genaicode: 'submit', data: { ok: true } } });
      Object.defineProperty(event, 'source', { value: page });
      window.dispatchEvent(event);
    });
    click(button('Send to agent')!);
    expect(onSubmit).toHaveBeenCalledWith(v2, { ok: true });
  });

  it('offers a right-click Reveal context menu on file links when onRevealFile is provided', () => {
    const onOpenFile = vi.fn();
    const onRevealFile = vi.fn();
    const state = fixture({
      turns: [
        {
          id: 1,
          agent: 'claude',
          prompt: 'p',
          startedAt: 1,
          entries: [{ kind: 'text', text: 'Check [notes.md](/w/notes.md).', streaming: false }],
        },
      ],
    });
    render({ state, onOpenFile, onRevealFile });
    act(() => {
      $('.gc-file-link').dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 50 }),
      );
    });
    const menu = $('[role="menu"]');
    expect(menu).not.toBeNull();
    const revealBtn = Array.from(menu.querySelectorAll('button')).find((b) => b.textContent?.startsWith('Reveal'))!;
    click(revealBtn);
    expect(onRevealFile).toHaveBeenCalledWith('/w/notes.md');
    expect($('[role="menu"]')).toBeNull();
  });
});
