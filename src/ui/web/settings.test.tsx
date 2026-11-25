// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ARTIFACT_CDN_HOSTS } from '../../agents/cdn.js';
import { agentGuide } from '../../agents/drivers/catalog.js';
import type { AgentInspection } from '../../agents/status.js';
import { BUG_REPORT_URL, SUPPORT_URL } from '../../support.js';
import {
  AboutSection,
  agentsNeedingYou,
  AgentsSection,
  ArtifactsSection,
  cdnChoice,
  GeneralSection,
  SettingsPage,
  settingsSections,
  TeamSection,
  UsageSection,
  type SettingsPageProps,
} from './settings.js';
import { TERMS_URL } from './sidebar.js';
import { applyTheme, readTheme, THEME_KEY, useTheme, type ThemeChoice } from './theme.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const now = Date.parse('2026-11-25T10:00:00Z');
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
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.theme;
});

const render = (node: React.ReactNode) => act(() => root.render(node));
const flush = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));
const button = (name: string) =>
  Array.from(host.querySelectorAll('button')).find(
    (one) => one.getAttribute('aria-label') === name || one.textContent?.trim() === name,
  )!;
const click = (element: Element) => act(() => (element as HTMLElement).click());
const type = (element: Element, value: string) =>
  act(() => {
    const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });

function agent(name: string, patch: Partial<AgentInspection> = {}): AgentInspection {
  const guide = agentGuide(name);
  return { name, command: guide.command, installed: true, auth: 'ready', guide, ...patch };
}

/** Answers `fetch` from a table of paths, and keeps what was asked. */
function stubFetch(routes: Record<string, (init?: RequestInit) => { status?: number; body: unknown }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      calls.push({ url: input, init });
      const path = Object.keys(routes).find((key) => input.startsWith(key));
      if (!path) return new Response('{}', { status: 404 });
      const { status = 200, body } = routes[path]!(init);
      return new Response(JSON.stringify(body), { status });
    }),
  );
  return calls;
}

function memoryStore(initial?: string) {
  const values = new Map<string, string>(initial === undefined ? [] : [[THEME_KEY, initial]]);
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

describe('theme', () => {
  it('follows the system until one is chosen, and keeps the choice', () => {
    const store = memoryStore();
    expect(readTheme(store)).toBe('system');
    expect(readTheme(memoryStore('dark'))).toBe('dark');
    // Anything else that was kept is not a theme.
    expect(readTheme(memoryStore('sepia'))).toBe('system');

    let set!: (choice: ThemeChoice) => void;
    function Probe() {
      const [theme, setTheme] = useTheme(store);
      set = setTheme;
      return <i>{theme}</i>;
    }
    render(<Probe />);
    expect(host.textContent).toBe('system');
    expect(document.documentElement.dataset.theme).toBeUndefined();

    act(() => set('dark'));
    expect(host.textContent).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(store.values.get(THEME_KEY)).toBe('dark');

    act(() => set('system'));
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(store.values.has(THEME_KEY)).toBe(false);
  });

  it('survives blocked storage', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readTheme(blocked)).toBe('system');
    const element = document.createElement('div');
    applyTheme('light', element);
    expect(element.dataset.theme).toBe('light');
    applyTheme('system', element);
    expect(element.dataset.theme).toBeUndefined();
  });
});

describe('<GeneralSection>', () => {
  it('marks the theme in use and reports another choice', () => {
    const onTheme = vi.fn();
    render(<GeneralSection theme="system" onTheme={onTheme} />);
    const group = host.querySelector('[role="group"][aria-label="Theme"]')!;
    expect(Array.from(group.querySelectorAll('button')).map((one) => one.getAttribute('aria-pressed'))).toEqual([
      'true',
      'false',
      'false',
    ]);
    click(button('Dark'));
    expect(onTheme).toHaveBeenCalledWith('dark');
    // Not connected yet: the bark is the server's to say.
    expect(host.querySelector('[role="switch"]')).toBeNull();
  });

  it('toggles the bark with a switch that says its state', () => {
    const onBark = vi.fn();
    render(<GeneralSection theme="light" onTheme={vi.fn()} bark={true} onBark={onBark} />);
    const bark = host.querySelector('[role="switch"]')!;
    expect(bark.getAttribute('aria-label')).toBe('Bark when an agent needs you');
    expect(bark.getAttribute('aria-checked')).toBe('true');
    click(bark);
    expect(onBark).toHaveBeenCalledWith(false);

    render(<GeneralSection theme="light" onTheme={vi.fn()} bark={false} onBark={onBark} />);
    expect(host.querySelector('[role="switch"]')!.getAttribute('aria-checked')).toBe('false');
  });
});

describe('<AgentsSection>', () => {
  const agents = [
    agent('claude', { version: '2.4.1', plan: 'Max', path: '/opt/homebrew/bin/claude' }),
    agent('codex', { version: '0.61' }),
    agent('cursor', { auth: 'signed-out' }),
    agent('gemini', { broken: true, hint: 'Bad CPU type in executable' }),
    agent('muse', { installed: false, auth: 'unknown' }),
  ];
  const row = (name: string) => host.querySelector<HTMLElement>(`[data-agent="${name}"]`)!;

  it('says the state of every agent, with the commands that fix it', () => {
    render(
      <AgentsSection
        agents={agents}
        loading={false}
        checking={false}
        current="claude"
        onCheckAgain={vi.fn()}
        onUse={vi.fn()}
      />,
    );
    expect(row('claude').dataset.state).toBe('ready');
    expect(row('claude').querySelector('small')!.textContent).toBe(
      'Ready · 2.4.1 · Max plan · /opt/homebrew/bin/claude',
    );
    expect(row('claude').querySelector('.pill')!.textContent).toBe('In use');
    expect(row('claude').querySelector('button')).toBeNull();

    expect(row('codex').querySelector('button')!.getAttribute('aria-label')).toBe(`Use ${agentGuide('codex').title}`);

    expect(row('cursor').dataset.state).toBe('signed-out');
    expect(row('cursor').querySelector('.pill')!.textContent).toBe('Sign in');
    expect(row('cursor').querySelector('.copy-row code')!.textContent).toBe(agentGuide('cursor').loginCommand);

    expect(row('gemini').dataset.state).toBe('broken');
    expect(row('gemini').querySelector('small.problem')!.textContent).toBe('Bad CPU type in executable');

    expect(row('muse').dataset.state).toBe('missing');
    expect(Array.from(row('muse').querySelectorAll('.copy-row code')).map((one) => one.textContent)).toEqual([
      ...agentGuide('muse').install,
    ]);
    // Two are installed and cannot run as they are.
    expect(agentsNeedingYou(agents)).toBe(2);
  });

  it('uses an agent, and checks again', async () => {
    const onUse = vi.fn();
    const onCheckAgain = vi.fn(async () => undefined as AgentInspection[] | undefined);
    render(
      <AgentsSection agents={agents} loading={false} checking={false} onCheckAgain={onCheckAgain} onUse={onUse} />,
    );
    click(row('codex').querySelector('button')!);
    expect(onUse).toHaveBeenCalledWith('codex');

    click(button('Check again'));
    await flush();
    expect(onCheckAgain).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[role="status"]')!.textContent).toBe('Could not reach genaicode to check agents.');

    render(<AgentsSection agents={agents} loading={false} checking={true} onCheckAgain={onCheckAgain} />);
    expect(button('Checking…').disabled).toBe(true);
    // Without a chat to switch (setup), no Use buttons.
    expect(row('codex').querySelector('button')).toBeNull();
  });

  it('marks the agent it was opened for', () => {
    render(
      <AgentsSection agents={agents} loading={false} checking={false} focusAgent="cursor" onCheckAgain={vi.fn()} />,
    );
    expect(row('cursor').classList.contains('focused')).toBe(true);
    expect(host.querySelectorAll('.focused')).toHaveLength(1);
  });
});

describe('<TeamSection>', () => {
  const team = {
    project: '/work/app',
    team: { lead: 'codex', members: ['claude', 'codex'] },
    choices: [
      { name: 'claude', installed: true, canLead: true },
      { name: 'codex', installed: true, canLead: true },
      { name: 'gemini', installed: true, canLead: false },
      { name: 'muse', installed: false, canLead: false },
    ],
    saved: true,
  };

  it('loads the team of the chat’s project and saves a change', async () => {
    const calls = stubFetch({
      '/api/sessions': () => ({ body: { sessions: [{ cwd: '/work/site' }, { cwd: '/work/app' }, {}] } }),
      '/api/pack-profile': () => ({ body: team }),
    });
    render(<TeamSection token="tok" cwd="/work/app" sessions />);
    await flush();
    const folder = host.querySelector<HTMLInputElement>('input[aria-label="Project folder"]')!;
    expect(folder.value).toBe('/work/app');
    // Recent folders are offered, once each.
    expect(Array.from(host.querySelectorAll('datalist option')).map((one) => one.getAttribute('value'))).toEqual([
      '/work/app',
      '/work/site',
    ]);
    const lead = host.querySelector<HTMLSelectElement>('select[aria-label="Lead"]')!;
    expect(lead.value).toBe('codex');
    // Only installed agents that can lead; only installed ones as workers.
    expect(Array.from(lead.options).map((one) => one.value)).toEqual(['claude', 'codex']);
    const boxes = Array.from(host.querySelectorAll<HTMLInputElement>('.check input'));
    expect(boxes.map((one) => [one.parentElement!.textContent, one.checked])).toEqual([
      ['claude', true],
      ['codex', true],
      ['gemini', false],
    ]);

    click(boxes[2]!);
    click(button('Remember this team for the project'));
    await flush();
    const post = calls.find((call) => call.init?.method === 'POST')!;
    expect(post.url).toBe('/api/pack-profile?project=%2Fwork%2Fapp');
    expect(JSON.parse(post.init!.body as string)).toEqual({ lead: 'codex', members: ['claude', 'codex', 'gemini'] });
    expect((post.init!.headers as Record<string, string>)['x-genaicode-token']).toBe('tok');
    expect(host.querySelector('[role="status"]')!.textContent).toContain('Team saved in .genaicode/pack.json');
  });

  it('opens a typed folder, or one from the host’s dialog, and says what went wrong', async () => {
    const calls = stubFetch({
      '/api/pack-profile?project=%2Fnowhere': () => ({ status: 400, body: { error: 'Choose a project folder.' } }),
      '/api/pack-profile': () => ({ body: team }),
    });
    const choose = vi.fn(async () => '/work/app');
    render(<TeamSection token="tok" sessions={false} choose={choose} />);
    // Nothing to save before a project is open; no sessions, so no recent folders are asked for.
    expect(button('Remember this team for the project').disabled).toBe(true);
    expect(button('Open').disabled).toBe(true);
    expect(calls).toHaveLength(0);

    const folder = host.querySelector<HTMLInputElement>('input[aria-label="Project folder"]')!;
    type(folder, '/nowhere');
    click(button('Open'));
    await flush();
    expect(host.querySelector('[role="alert"]')!.textContent).toBe('Choose a project folder.');
    expect(host.querySelector('select[aria-label="Lead"]')).toBeNull();

    click(button('Choose…'));
    await flush();
    expect(choose).toHaveBeenCalledTimes(1);
    expect(folder.value).toBe('/work/app');
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector<HTMLSelectElement>('select[aria-label="Lead"]')!.value).toBe('codex');
  });

  it('has no Choose… button without a folder dialog', () => {
    stubFetch({});
    render(<TeamSection token="tok" sessions={false} />);
    expect(button('Choose…')).toBeUndefined();
  });
});

describe('<ArtifactsSection>', () => {
  const origins = DEFAULT_ARTIFACT_CDN_HOSTS.map((one) => `https://${one}`);

  it('splits an allow-list into the preset and the rest', () => {
    expect(cdnChoice([])).toEqual({ preset: false, custom: '' });
    expect(cdnChoice([...origins, 'https://cdn.skypack.dev'])).toEqual({ preset: true, custom: 'cdn.skypack.dev' });
    // Part of the preset is not the preset: its hosts stay listed, so a save does not drop them.
    expect(cdnChoice([origins[0]!])).toEqual({ preset: false, custom: DEFAULT_ARTIFACT_CDN_HOSTS[0] });
  });

  it('saves the preset and the extra hosts', async () => {
    const calls = stubFetch({ '/api/settings': () => ({ body: { ok: true } }) });
    render(<ArtifactsSection token="tok" hosts={[]} />);
    const preset = host.querySelector('[role="switch"]')!;
    expect(preset.getAttribute('aria-checked')).toBe('false');
    click(preset);
    expect(preset.getAttribute('aria-checked')).toBe('true');
    type(host.querySelector('textarea')!, 'cdn.skypack.dev, esm.run\n\n');
    click(button('Save'));
    await flush();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.init?.method).toBe('POST');
    expect(JSON.parse(calls[0]!.init!.body as string)).toEqual({
      artifactCdn: [...DEFAULT_ARTIFACT_CDN_HOSTS, 'cdn.skypack.dev', 'esm.run'],
    });
    expect(host.querySelector('[role="status"]')!.textContent).toBe('Settings saved.');
    // A further change is not saved yet.
    click(preset);
    expect(host.querySelector('[role="status"]')).toBeNull();
  });

  it('says why a save failed, and follows a list changed elsewhere', async () => {
    stubFetch({ '/api/settings': () => ({ status: 400, body: { error: 'bad settings' } }) });
    render(<ArtifactsSection token="tok" hosts={[]} />);
    click(button('Save'));
    await flush();
    expect(host.querySelector('[role="alert"]')!.textContent).toBe('bad settings');

    render(<ArtifactsSection token="tok" hosts={[...origins, 'https://cdn.skypack.dev']} />);
    expect(host.querySelector('[role="switch"]')!.getAttribute('aria-checked')).toBe('true');
    expect(host.querySelector('textarea')!.value).toBe('cdn.skypack.dev');
  });
});

describe('<UsageSection>', () => {
  it('lists every agent’s limits and where its work went', async () => {
    const calls = stubFetch({
      '/api/shares': () => ({
        body: {
          shares: [
            {
              agent: 'claude',
              by: 'cost',
              shares: [
                { topic: 't1', name: 'Sidebars', share: 0.58, sessions: 7 },
                { name: 'Not sorted yet', share: 0.4, sessions: 3 },
                { topic: 't3', name: 'Tiny', share: 0.02, sessions: 1 },
              ],
            },
          ],
        },
      }),
    });
    const onTopic = vi.fn();
    render(
      <UsageSection
        token="tok"
        shares
        now={now}
        onTopic={onTopic}
        limits={[
          { agent: 'claude', window: '5h', status: 'warning', usedPercent: 91 },
          { agent: 'codex', window: 'quota', status: 'exceeded' },
          { agent: 'agy', window: '5h', status: 'ok' },
        ]}
      />,
    );
    await flush();
    expect(calls[0]!.url).toBe('/api/shares?days=7');
    const row = (name: string) => host.querySelector<HTMLElement>(`[data-agent="${name}"]`)!;
    expect(Array.from(host.querySelectorAll('[data-agent]')).map((one) => one.getAttribute('data-agent'))).toEqual([
      'agy',
      'claude',
      'codex',
    ]);
    expect(row('claude').querySelector('.pill')!.className).toBe('pill warn');
    expect(row('claude').querySelector('.pill')!.textContent).toContain('91%');
    expect(row('codex').querySelector('.pill')!.className).toBe('pill err');
    // A limit that says nothing is said so.
    expect(row('agy').querySelector('.pill')!.textContent).toBe('reports no plan limits');
    // Parts under 5% are left out; a topic opens its sessions, the rest is plain text.
    const bars = Array.from(row('claude').querySelectorAll('.bar'));
    expect(bars.map((one) => one.textContent)).toEqual(['Sidebars58%', 'Not sorted yet40%']);
    expect(bars[0]!.querySelector<HTMLElement>('.meter i')!.style.width).toBe('58%');
    expect(bars[1]!.querySelector('button')).toBeNull();
    click(bars[0]!.querySelector('button')!);
    expect(onTopic).toHaveBeenCalledWith('t1');
  });

  it('asks for no shares without a session index, and says when nothing is known', () => {
    const calls = stubFetch({});
    render(<UsageSection token="tok" shares={false} limits={[]} now={now} />);
    expect(calls).toHaveLength(0);
    expect(host.textContent).toContain('No agent has reported a plan limit yet.');
    expect(host.textContent).not.toContain('by topic');
  });
});

describe('<AboutSection>', () => {
  it('names the version, opens the notes and links to help', () => {
    const onWhatsNew = vi.fn();
    render(<AboutSection version="3.3.0" onWhatsNew={onWhatsNew} />);
    expect(host.querySelector('p')!.textContent).toBe('Genaicode 3.3.0.');
    expect(host.textContent).toContain('What’s new in 3.3.0');
    click(button('Read'));
    expect(onWhatsNew).toHaveBeenCalledTimes(1);
    expect(Array.from(host.querySelectorAll('a')).map((one) => [one.textContent, one.getAttribute('href')])).toEqual([
      ['Get help', SUPPORT_URL],
      ['Report a bug', BUG_REPORT_URL],
      ['Terms', TERMS_URL],
    ]);
    // No update waits: no row for one.
    expect(button('Install and relaunch')).toBeUndefined();
  });

  it('installs a downloaded update, and waits for one that is not', () => {
    const onRelaunch = vi.fn();
    render(<AboutSection version="3.3.0" update={{ version: '3.4.0', ready: true }} onRelaunch={onRelaunch} />);
    expect(host.textContent).toContain('Version 3.4.0 is downloaded');
    click(button('Install and relaunch'));
    expect(onRelaunch).toHaveBeenCalledTimes(1);

    render(<AboutSection update={{ version: '3.4.0', ready: false }} onRelaunch={onRelaunch} />);
    expect(host.textContent).toContain('Version 3.4.0 is downloading');
    expect(button('Install and relaunch').disabled).toBe(true);

    render(<AboutSection update={{ version: '3.4.0', ready: true }} relaunching onRelaunch={onRelaunch} />);
    expect(button('Relaunching…').disabled).toBe(true);
  });
});

describe('<SettingsPage>', () => {
  const page = (patch: Partial<SettingsPageProps> = {}): SettingsPageProps => ({
    section: 'general',
    onSection: vi.fn(),
    general: { theme: 'system', onTheme: vi.fn() },
    agents: {
      agents: [agent('claude'), agent('cursor', { auth: 'signed-out' })],
      loading: false,
      checking: false,
      onCheckAgain: vi.fn(),
    },
    team: { token: 'tok', sessions: false },
    artifacts: { token: 'tok', hosts: [] },
    usage: { token: 'tok', limits: [], shares: false },
    about: { version: '3.3.0' },
    ...patch,
  });
  const nav = () => Array.from(host.querySelectorAll('nav[aria-label="Settings sections"] button'));

  it('lists the sections, shows one, and counts the agents that need a hand', () => {
    const props = page();
    render(<SettingsPage {...props} />);
    expect(host.querySelector('main')!.getAttribute('aria-label')).toBe('Settings');
    expect(nav().map((one) => one.querySelector('.grow')!.textContent)).toEqual([
      'General',
      'Agents',
      'Team',
      'Artifacts',
      'Usage',
      'About and updates',
    ]);
    expect(nav()[0]!.getAttribute('aria-current')).toBe('true');
    expect(nav()[1]!.querySelector('.count')!.textContent).toBe('1');
    expect(host.querySelector('.sec')!.getAttribute('data-section')).toBe('general');
    expect(host.querySelector('.sec h3')!.textContent).toBe('General');

    click(nav()[5]!);
    expect(props.onSection).toHaveBeenCalledWith('about');
    render(<SettingsPage {...props} section="about" />);
    expect(nav()[5]!.getAttribute('aria-current')).toBe('true');
    expect(nav()[0]!.getAttribute('aria-current')).toBeNull();
    expect(host.querySelector('.sec h3')!.textContent).toBe('About and updates');
  });

  it('leaves out the sections the server has nothing for, and falls back to General', () => {
    const props = page({ agents: undefined, team: undefined, artifacts: undefined, section: 'team' });
    expect(settingsSections(props)).toEqual(['general', 'usage', 'about']);
    render(<SettingsPage {...props} />);
    expect(nav().map((one) => one.textContent)).toEqual(['General', 'Usage', 'About and updates']);
    expect(host.querySelector('.sec')!.getAttribute('data-section')).toBe('general');
  });

  it('leaves a field with text in it on Escape, so the next press goes back to the chat', () => {
    stubFetch({});
    render(<SettingsPage {...page({ section: 'artifacts' })} />);
    const field = host.querySelector('textarea')!;
    const escape = () =>
      act(() => void field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    act(() => field.focus());
    // Empty: the key is the window's, and the focus stays.
    escape();
    expect(document.activeElement).toBe(field);
    type(field, 'cdn.skypack.dev');
    escape();
    expect(document.activeElement).not.toBe(field);
    expect(field.value).toBe('cdn.skypack.dev');
  });

  it('shows each section by its name', () => {
    stubFetch({});
    for (const [section, heading] of [
      ['agents', 'Agents'],
      ['team', 'Team'],
      ['artifacts', 'Artifacts'],
      ['usage', 'Usage'],
    ] as const) {
      render(<SettingsPage {...page({ section })} />);
      expect(host.querySelector('.sec h3')!.textContent).toBe(heading);
      expect(host.querySelector('.sec')!.getAttribute('aria-label')).toBe(heading);
    }
  });
});
