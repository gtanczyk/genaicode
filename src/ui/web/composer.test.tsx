// @vitest-environment happy-dom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { agentGuide } from '../../agents/drivers/catalog.js';
import type { AgentInspection } from '../../agents/status.js';
import { chatProjects, quotaRows } from '../sidebar.js';
import {
  AgentChip,
  ComposerHint,
  fallbackNames,
  PermissionSwitch,
  PlanToggle,
  StartsIn,
  type AgentChipProps,
  type StartsInProps,
} from './composer.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = (node: ReactNode) => act(() => root.render(node));
const $ = <T extends Element = HTMLElement>(selector: string) => host.querySelector(selector) as T;
const $$ = <T extends Element = HTMLElement>(selector: string) => Array.from(host.querySelectorAll<T>(selector));
const click = (element: Element) => act(() => (element as HTMLElement).click());
const named = (role: string, name: string) =>
  $$(`[role="${role}"], button`).find(
    (element) => (element.getAttribute('aria-label') ?? element.textContent) === name,
  )!;
const button = (label: string) => $$<HTMLButtonElement>('button').find((element) => element.textContent === label)!;
function fill(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const press = (target: Element | Window, key: string) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
const blur = (input: HTMLElement) =>
  act(() => {
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
const settle = () => act(async () => void (await Promise.resolve()));

const inspection = (name: string, patch: Partial<AgentInspection> = {}): AgentInspection => ({
  name,
  command: name,
  installed: true,
  auth: 'ready',
  guide: agentGuide(name, name),
  ...patch,
});

describe('AgentChip', () => {
  const agents = [
    inspection('claude', { plan: 'Max' }),
    inspection('codex', { auth: 'signed-out' }),
    inspection('gemini', { auth: 'unknown' }),
    inspection('cursor', { installed: false, auth: 'unknown' }),
  ];
  const chip = (patch: Partial<AgentChipProps> = {}): AgentChipProps => ({
    agent: 'claude',
    model: 'claude-opus-5-5',
    effort: 'high',
    efforts: ['low', 'medium', 'high'],
    fallback: ['codex'],
    agents,
    noQuestions: new Set(['gemini']),
    onAgent: vi.fn(),
    onModel: vi.fn(),
    onEffort: vi.fn(),
    onFallback: vi.fn(),
    onOpenSetup: vi.fn(),
    ...patch,
  });
  const trigger = () => $<HTMLButtonElement>('.agent-chip');
  const pop = () => $('[role="dialog"]');
  const field = (label: string) => {
    const el = $$<HTMLLabelElement>('.pop label').find((element) => element.textContent === label)!;
    return (el.htmlFor ? $(`#${el.htmlFor}`) : el.querySelector('input')) as HTMLInputElement;
  };

  it('is one chip that names the agent and its model, and opens one popover for agent, model, effort and fallback', () => {
    render(<AgentChip {...chip()} />);
    expect($$('select')).toEqual([]);
    expect(trigger().textContent).toBe('Cclaude · claude-opus-5-5');
    expect(trigger().getAttribute('aria-label')).toBe('Agent: claude, model claude-opus-5-5');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(pop()).toBeNull();

    click(trigger());
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(pop().getAttribute('aria-label')).toBe('Agent, model, effort and fallback');
    // Agents: the usable ones can be chosen, the others say what they need.
    const radios = $$('[role="radiogroup"][aria-label="Agent"] [role="radio"]');
    expect(radios.map((element) => [element.textContent, element.getAttribute('aria-checked')])).toEqual([
      ['Claude CodeMax', 'true'],
      ['Gemini CLIInstalled · no questions', 'false'],
    ]);
    expect(pop().textContent).toContain('Not signed in');
    expect(pop().textContent).toContain('More agents');
    expect(field('Model').value).toBe('claude-opus-5-5');
    expect(
      $$('[role="group"][aria-labelledby="composer-effort"] button').map((element) => [
        element.textContent,
        element.getAttribute('aria-pressed'),
      ]),
    ).toEqual([
      ['default', 'false'],
      ['low', 'false'],
      ['medium', 'false'],
      ['high', 'true'],
    ]);
    expect(field('Fallback when it runs out').value).toBe('codex');
  });

  it('reports each choice: another agent closes the popover, a field commits on Enter or when left', () => {
    const props = chip();
    render(<AgentChip {...props} />);
    click(trigger());
    click(button('low'));
    expect(props.onEffort).toHaveBeenCalledWith('low');
    click(button('default'));
    expect(props.onEffort).toHaveBeenLastCalledWith('default');

    fill(field('Model'), ' claude-sonnet-5-5 ');
    expect(props.onModel).not.toHaveBeenCalled();
    blur(field('Model'));
    expect(props.onModel).toHaveBeenCalledWith('claude-sonnet-5-5');
    // Left as it was: nothing to say.
    blur(field('Model'));
    expect(props.onModel).toHaveBeenCalledTimes(1);

    fill(field('Fallback when it runs out'), 'codex, gemini  codex');
    blur(field('Fallback when it runs out'));
    expect(props.onFallback).toHaveBeenCalledWith(['codex', 'gemini']);
    fill(field('Fallback when it runs out'), '');
    blur(field('Fallback when it runs out'));
    expect(props.onFallback).toHaveBeenLastCalledWith([]);

    click(button('Sign in'));
    expect(props.onOpenSetup).toHaveBeenCalledWith('codex');
    expect(pop()).toBeNull();

    click(trigger());
    click(named('radio', 'Gemini CLIInstalled · no questions'));
    expect(props.onAgent).toHaveBeenCalledWith('gemini');
    expect(pop()).toBeNull();
    // The agent it already is: closed, and nothing to switch.
    click(trigger());
    click(named('radio', 'Claude CodeMax'));
    expect(props.onAgent).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape, which goes no further, and on a click outside', () => {
    render(<AgentChip {...chip()} />);
    const reached = vi.fn();
    window.addEventListener('keydown', reached);
    try {
      click(trigger());
      press(pop(), 'Escape');
      expect(pop()).toBeNull();
      expect(reached).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(trigger());
      click(trigger());
      act(() => {
        document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      });
      expect(pop()).toBeNull();
    } finally {
      window.removeEventListener('keydown', reached);
    }
  });

  it('keeps the agent while a turn runs, has no effort control for an agent without levels, and no setup rows without an agents page', () => {
    render(
      <AgentChip
        {...chip({ running: true, efforts: [], model: undefined, reportedModel: 'gpt-6', onOpenSetup: undefined })}
      />,
    );
    expect(trigger().textContent).toBe('Cclaude · gpt-6');
    click(trigger());
    expect($<HTMLButtonElement>('[role="radio"][aria-checked="false"]').disabled).toBe(true);
    expect(pop().textContent).toContain('The agent can be changed when this turn ends.');
    expect($('[aria-labelledby="composer-effort"]')).toBeNull();
    expect(field('Model').value).toBe('');
    expect(field('Model').placeholder).toBe('default (last ran gpt-6)');
    expect(button('Sign in')).toBeUndefined();
    expect(button('Connect another agent…')).toBeUndefined();
  });

  it('reads a typed fallback list', () => {
    expect(fallbackNames('codex, agy')).toEqual(['codex', 'agy']);
    expect(fallbackNames(' codex   codex,,gemini ')).toEqual(['codex', 'gemini']);
    expect(fallbackNames('')).toEqual([]);
  });

  it('opens a model dropdown, filters by typing, picks a model or default, and explains agent status in tooltips', () => {
    const props = chip({
      model: 'gemini-4-neon-high',
      reportedModel: 'gemini-4-neon-medium',
      models: [
        { model: 'gemini-4-neon-high', label: 'Gemini 4 Neon (High)', note: 'Gemini 4 Neon (High)' },
        { model: 'claude-opus-5-5-high', label: 'Claude Opus 5.5 (High)', note: 'picked lately' },
      ],
    });
    render(<AgentChip {...props} />);
    click(trigger());
    expect(props.onOpen).toBeUndefined();
    // Agent rows carry clear tooltips explaining signed-in vs installed status.
    expect(named('radio', 'Claude CodeMax').getAttribute('title')).toContain('signed in (Max)');
    expect(named('radio', 'Gemini CLIInstalled · no questions').getAttribute('title')).toContain(
      'sign-in is checked when you run it',
    );

    // Clicking the chevron opens the dropdown with Agent's default + all models (even though a model is set).
    click($<HTMLButtonElement>('.model-combo-toggle'));
    const options = () => $$<HTMLButtonElement>('#agent-models [role="option"]');
    expect(options().map((el) => el.getAttribute('data-value'))).toEqual([
      '',
      'gemini-4-neon-high',
      'claude-opus-5-5-high',
    ]);
    expect(options()[2]!.textContent).toContain('Claude Opus 5.5 (High) · picked lately');

    // Typing filters the list; pressing Escape closes only the dropdown, leaving the popover open.
    fill(field('Model'), 'opus');
    expect(options().map((el) => el.getAttribute('data-value'))).toEqual(['claude-opus-5-5-high']);
    press(field('Model'), 'Escape');
    expect($('#agent-models')).toBeNull();
    expect(pop()).not.toBeNull();

    // Clicking an option commits it and closes the menu.
    click($<HTMLButtonElement>('.model-combo-toggle'));
    click(options()[2]!);
    expect(props.onModel).toHaveBeenCalledWith('claude-opus-5-5-high');
    expect($('#agent-models')).toBeNull();

    // Picking Agent's default commits empty string.
    click($<HTMLButtonElement>('.model-combo-toggle'));
    click(options()[0]!);
    expect(props.onModel).toHaveBeenLastCalledWith('');
  });
});

describe('Plan and the permission switch', () => {
  it('toggles Plan', () => {
    const onToggle = vi.fn();
    render(<PlanToggle on={false} onToggle={onToggle} />);
    expect(button('Plan').getAttribute('aria-pressed')).toBe('false');
    click(button('Plan'));
    expect(onToggle).toHaveBeenCalledWith(true);
    render(<PlanToggle on onToggle={onToggle} />);
    expect(button('Plan').getAttribute('aria-pressed')).toBe('true');
    click(button('Plan'));
    expect(onToggle).toHaveBeenLastCalledWith(false);
  });

  it('names both permission states, "Auto-approve all" for the chat', () => {
    const onChange = vi.fn();
    render(<PermissionSwitch auto={false} onChange={onChange} />);
    expect($('[role="group"]').getAttribute('aria-label')).toBe('Permission requests in this chat');
    expect(button('Auto-approve all').title).toBe('Approves every permission request for the rest of this chat');
    expect($$('button').map((element) => [element.textContent, element.getAttribute('aria-pressed')])).toEqual([
      ['Ask first', 'true'],
      ['Auto-approve all', 'false'],
    ]);
    click(button('Auto-approve all'));
    expect(onChange).toHaveBeenCalledWith(true);
    render(<PermissionSwitch auto onChange={onChange} />);
    expect(button('Auto-approve all').getAttribute('aria-pressed')).toBe('true');
    // Where only this button shows (a narrow composer), pressing it again asks first.
    click(button('Auto-approve all'));
    expect(onChange).toHaveBeenLastCalledWith(false);
    click(button('Ask first'));
    expect(onChange).toHaveBeenLastCalledWith(false);
  });
});

describe('StartsIn', () => {
  const now = Date.parse('2026-11-25T10:00:00Z');
  const projects = chatProjects(
    ['/work/app', '/work/site', '/home/me/.genaicode/home'].map((cwd, index) => ({
      source: 'claude',
      agent: 'claude',
      id: `s${index}`,
      where: 'local' as const,
      cwd,
      state: 'waiting' as const,
      updatedAt: now - index * 60_000,
    })),
    { home: '/home/me/.genaicode/home' },
  );
  // As the page numbers the chats a window asks for: each choice that switches counts one up.
  let asked = 0;
  beforeEach(() => {
    asked = 0;
  });
  const line = (patch: Partial<StartsInProps> = {}): StartsInProps => ({
    cwd: '/work/app',
    folder: { path: '/work/app', exists: true, git: true, branch: 'main' },
    projects,
    canChange: true,
    mark: () => asked,
    onProject: vi.fn(async (_path: string, mark: number) => {
      if (mark !== asked) return undefined;
      asked += 1;
      return true;
    }),
    onHome: vi.fn(() => void (asked += 1)),
    onStay: vi.fn(() => void (asked += 1)),
    inspect: vi.fn(async (path: string) =>
      path === '~/src/new' ? { path: '/home/me/src/new', exists: true, git: false } : { path, exists: false },
    ),
    ...patch,
  });
  const trigger = () => $$<HTMLButtonElement>('button').find((element) => element.getAttribute('aria-haspopup'))!;
  const pop = () => $('[role="dialog"][aria-label="Project"]');
  const path = () => $<HTMLInputElement>('input[aria-label="Folder path"]');

  it('says where the prompt will run: the folder and its branch', () => {
    const props = line();
    render(<StartsIn {...props} />);
    expect(host.textContent).toContain('Starts in');
    expect(trigger().getAttribute('aria-label')).toBe('Starts in app, branch main');
    expect(trigger().title).toBe('/work/app');
    expect($('.starts-where').textContent).toBe('/work/app');
    expect(button('New worktree')).toBeUndefined();
    render(<StartsIn {...line({ atHome: true, cwd: '/home/me/.genaicode/home' })} />);
    expect(trigger().getAttribute('aria-label')).toBe('Starts in Home folder, branch main');
  });

  it('lists the recent directories and the home folder, and starts in the one picked', () => {
    const props = line();
    render(<StartsIn {...props} />);
    click(trigger());
    const options = $$('[role="radiogroup"][aria-label="Project"] [role="radio"]');
    expect(options.map((element) => [element.textContent, element.getAttribute('aria-checked')])).toEqual([
      ['app/work/app', 'true'],
      ['site/work/site', 'false'],
      ['Home folderquestions across projects', 'false'],
    ]);
    click(options[1]!);
    expect(props.onProject).toHaveBeenCalledWith('/work/site', 0);
    expect(pop()).toBeNull();
    click(trigger());
    click(named('radio', 'Home folderquestions across projects'));
    expect(props.onHome).toHaveBeenCalledTimes(1);
    // The one it is in already: closed, and nothing started again.
    click(trigger());
    click(named('radio', 'app/work/app'));
    expect(props.onProject).toHaveBeenCalledTimes(1);
    expect(pop()).toBeNull();
  });

  it('names a folder that is in no list, first and checked', () => {
    render(<StartsIn {...line({ cwd: '/work/other/' })} />);
    click(trigger());
    expect($('[role="radio"]').textContent).toBe('other/work/other/');
    expect($('[role="radio"]').getAttribute('aria-checked')).toBe('true');
  });

  it('takes another folder by its path, and says when there is none', async () => {
    const props = line();
    render(<StartsIn {...props} />);
    click(trigger());
    expect(button('Choose…')).toBeUndefined();
    expect(button('Open').disabled).toBe(true);
    fill(path(), '/work/nowhere');
    click(button('Open'));
    await settle();
    expect($('[role="alert"]').textContent).toBe('No folder /work/nowhere.');
    expect(props.onProject).not.toHaveBeenCalled();
    // Typing again takes the complaint away; Enter opens too, and `~` is the server's to read.
    fill(path(), '~/src/new');
    expect($('[role="alert"]')).toBeNull();
    press(path(), 'Enter');
    await settle();
    expect(props.inspect).toHaveBeenLastCalledWith('~/src/new');
    expect(props.onProject).toHaveBeenCalledWith('/home/me/src/new', 0);
    expect(pop()).toBeNull();
  });

  it('keeps the popover open and says so when the chat could not start in a typed folder', async () => {
    const props = line({ onProject: vi.fn(async () => false), choose: vi.fn(async () => undefined) });
    render(<StartsIn {...props} />);
    click(trigger());
    fill(path(), '~/src/new');
    click(button('Open'));
    await settle();
    await settle();
    expect(props.onProject).toHaveBeenCalledWith('/home/me/src/new', 0);
    expect($('[role="alert"]').textContent).toBe(
      'Could not start in /home/me/src/new: a typed path opens only a folder one of your sessions worked in. Choose… opens any folder.',
    );
    expect(pop()).not.toBeNull();
    expect(path().value).toBe('~/src/new');
  });

  it('has the host’s folder dialog where there is one; a dismissed dialog changes nothing', async () => {
    const choose = vi
      .fn<NonNullable<StartsInProps['choose']>>()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ path: '/work/picked', exists: true, git: true });
    const props = line({ choose });
    render(<StartsIn {...props} />);
    click(trigger());
    click(button('Choose…'));
    await settle();
    expect(props.onProject).not.toHaveBeenCalled();
    expect(pop()).not.toBeNull();
    click(button('Choose…'));
    await settle();
    expect(props.onProject).toHaveBeenCalledWith('/work/picked', 0);
    expect(pop()).toBeNull();
  });

  it('drops a typed folder found only after another folder was picked', async () => {
    let found!: (folder: { path: string; exists: boolean }) => void;
    const props = line({
      inspect: vi.fn(() => new Promise<{ path: string; exists: boolean }>((resolve) => (found = resolve))),
    });
    render(<StartsIn {...props} />);
    click(trigger());
    fill(path(), '/work/slow');
    click(button('Open'));
    // While the typed folder is looked up, the person picks a recent one.
    click(named('radio', 'site/work/site'));
    expect(props.onProject).toHaveBeenCalledWith('/work/site', 0);
    found({ path: '/work/slow', exists: true });
    await settle();
    await settle();
    expect(props.onProject).toHaveBeenCalledTimes(1);
    expect($('[role="alert"]')).toBeNull();
  });

  it('gives Open and Choose… back at once when the folder it starts in is picked again', async () => {
    let found!: (folder: { path: string; exists: boolean }) => void;
    const props = line({
      inspect: vi.fn(() => new Promise<{ path: string; exists: boolean }>((resolve) => (found = resolve))),
      choose: vi.fn(async () => undefined),
    });
    render(<StartsIn {...props} />);
    click(trigger());
    fill(path(), '/work/slow');
    click(button('Open'));
    expect(button('Open').disabled).toBe(true);
    expect(button('Choose…').disabled).toBe(true);
    // The person picks the folder it starts in again, then opens the popover for another path:
    // the old lookup, still under way, no longer holds the buttons.
    click(named('radio', 'app/work/app'));
    click(trigger());
    fill(path(), '/work/next');
    expect(button('Open').disabled).toBe(false);
    expect(button('Choose…').disabled).toBe(false);
    found({ path: '/work/slow', exists: true });
    await settle();
    expect(props.onProject).not.toHaveBeenCalled();
  });

  it.each([
    ['the folder it starts in, from the recent ones', {}, 'app/work/app'],
    ['a folder in no list', { cwd: '/work/other' }, 'other/work/other'],
    ['the home folder', { atHome: true, cwd: '/home/me/.genaicode/home' }, 'Home folderquestions across projects'],
  ] as const)('drops a typed folder found after %s was picked again', async (_, patch, row) => {
    let found!: (folder: { path: string; exists: boolean }) => void;
    const props = line({
      ...patch,
      inspect: vi.fn(() => new Promise<{ path: string; exists: boolean }>((resolve) => (found = resolve))),
    });
    render(<StartsIn {...props} />);
    click(trigger());
    fill(path(), '/work/slow');
    click(button('Open'));
    // While the typed folder is looked up, the person picks the one the chat starts in already.
    click(named('radio', row));
    expect(pop()).toBeNull();
    expect(props.onStay).toHaveBeenCalledTimes(1);
    found({ path: '/work/slow', exists: true });
    await settle();
    await settle();
    expect(props.onProject).not.toHaveBeenCalled();
    expect(props.onHome).not.toHaveBeenCalled();
  });

  it('drops a folder the dialog answers with after another chat was asked for', async () => {
    let picked!: (folder: { path: string; exists: boolean }) => void;
    const props = line({
      choose: vi.fn(() => new Promise<{ path: string; exists: boolean }>((resolve) => (picked = resolve))),
    });
    render(<StartsIn {...props} />);
    click(trigger());
    click(button('Choose…'));
    // The sidebar starts another chat while the dialog is open.
    asked += 1;
    picked({ path: '/work/picked', exists: true });
    await settle();
    expect(props.onProject).not.toHaveBeenCalled();
  });

  it('only names the folder where the chat has one project', () => {
    render(<StartsIn {...line({ canChange: false })} />);
    expect(host.textContent).toBe('Starts inapp · main/work/app');
    expect($$('button')).toEqual([]);
    expect($('.starts-fixed').title).toBe('/work/app');
  });
});

describe('ComposerHint', () => {
  const quota = quotaRows(
    [
      { agent: 'claude', window: '5h', status: 'ok', usedPercent: 40 },
      { agent: 'gemini', window: '7d', status: 'warning', usedPercent: 91 },
      { agent: 'codex', window: '5h', status: 'exceeded' },
      // Claude may still call 91% "allowed": the share used decides, not the agent's word.
      { agent: 'claudeWork', window: '7d', status: 'ok', usedPercent: 91 },
      { agent: 'opencode', window: '5h', status: 'ok', usedPercent: 80 },
      // Flagged by the agent, but under the line.
      { agent: 'qwen', window: '5h', status: 'warning', usedPercent: 79 },
    ],
    [],
    Date.parse('2026-11-25T10:00:00Z'),
  );

  it('says what Enter does, and names only the agents at 80% or more of their plan, or out', () => {
    render(<ComposerHint action="send" quota={quota} files />);
    expect($('span').textContent).toBe('Enter sends · Shift+Enter new line · / for commands · files send without text');
    expect($$('.hot').map((element) => element.textContent)).toEqual([
      'codex out',
      'claudeWork 91% · 7d',
      'gemini 91% · 7d',
      'opencode 80% · 5h',
    ]);
    render(<ComposerHint action="steer" canStop quota={[]} />);
    expect($('span').textContent).toMatch(
      /^Enter steers · Shift\+Enter new line · \/ for commands · (⌘\.|Ctrl\+\.) or Esc stops$/,
    );
    expect($$('.hot')).toEqual([]);
    render(<ComposerHint action="queue" quota={[]} />);
    expect($('span').textContent).toMatch(/^Enter queues/);
  });
});
