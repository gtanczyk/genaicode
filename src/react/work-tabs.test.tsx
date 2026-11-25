// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PackTask } from '../agents/pack.js';
import type { SessionEntry, SessionState } from '../agents/session.js';
import type { Artifact } from '../agents/types.js';
import { WorkPanel, type WorkPanelProps, type WorkPanelView } from '../react.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const artifact = (id: string, version: number, patch: Partial<Artifact> = {}): Artifact => ({
  id,
  name: id,
  title: `Report ${id}`,
  kind: 'html',
  mimeType: 'text/html',
  bytes: 2048,
  version,
  ...patch,
});
const task = (id: string, patch: Partial<PackTask>): PackTask => ({
  agent: 'codex',
  prompt: 'Do it.',
  cwd: `/work/app/.genaicode/worktrees/${id}-k1`,
  mode: 'worktree',
  id,
  status: 'completed',
  ...patch,
});

function session(entries: SessionEntry[], tasks?: PackTask[]): SessionState {
  return {
    agent: 'claude',
    cwd: '/work/app',
    status: 'idle',
    canSteer: true,
    usage: {},
    queued: [],
    approvals: [],
    turns: [
      {
        id: 7,
        agent: 'claude',
        prompt: 'go',
        startedAt: 0,
        entries,
        ...(tasks ? { pack: { lead: 'claude', maxParallel: 4, interactive: true, tasks } } : {}),
      },
    ],
  } as SessionState;
}

const DIFF = ['--- src/a.ts', '+++ src/a.ts', '@@ -1,2 +1,3 @@', ' one', '-two', '+2', '+3'].join('\n');

let host: HTMLDivElement;
let root: Root;
let view: WorkPanelView;
let props: Partial<WorkPanelProps>;
let state: SessionState;
let views: WorkPanelView[];

function draw() {
  act(() =>
    root.render(
      <WorkPanel
        state={state}
        view={view}
        onView={(next) => {
          view = next;
          views.push(next);
          draw();
        }}
        {...props}
      />,
    ),
  );
}

function show(next: SessionState, start: WorkPanelView, extra: Partial<WorkPanelProps> = {}) {
  state = next;
  view = start;
  props = extra;
  views = [];
  draw();
}

/** A host's viewer: says what is open and has the back button the panel asks for. */
const viewer: WorkPanelProps['renderViewer'] = (viewing, controls) => (
  <div className="test-viewer">
    <button type="button" onClick={controls.onBack}>
      {controls.backLabel}
    </button>
    <output>{viewing.kind === 'file' ? `file ${viewing.path}` : `artifact ${viewing.id}`}</output>
  </div>
);

const $ = <T extends Element = HTMLElement>(selector: string) => host.querySelector<T>(selector)!;
const $$ = (selector: string) => Array.from(host.querySelectorAll<HTMLElement>(selector));
const click = (element: Element | undefined | null) => act(() => (element as HTMLElement).click());
const tab = (name: string) => $$('[role="tab"]').find((item) => item.textContent?.trim().startsWith(name))!;
const rows = (selector = '.gc-work-frow') => $$(selector).map((item) => item.textContent?.replace(/\s+/g, ' ').trim());

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('<WorkPanel> tabs', () => {
  it('has Tasks, Live, Changes and Artifacts with their counts, and moves between them by click and arrow key', () => {
    show(
      session(
        [
          { kind: 'files', paths: ['src/a.ts'], diff: DIFF },
          { kind: 'artifact', artifact: artifact('a1', 1) },
        ],
        [task('t1', { state: 'unmerged', changes: ['M\tsrc/b.ts'] })],
      ),
      { tab: 'tasks' },
    );
    expect($$('[role="tab"]').map((item) => [item.textContent?.trim(), item.getAttribute('aria-selected')])).toEqual([
      ['Tasks 1', 'true'],
      ['Live', 'false'],
      ['Changes 2', 'false'],
      ['Artifacts 1', 'false'],
    ]);
    click(tab('Changes'));
    expect(view.tab).toBe('changes');
    expect($('[role="tabpanel"]').getAttribute('aria-label')).toBe('Changes');
    act(() => {
      tab('Changes').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(view.tab).toBe('artifacts');
    expect(document.activeElement).toBe(tab('Artifacts'));
    act(() => {
      tab('Artifacts').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(view.tab).toBe('tasks');
  });

  it('says so when a tab has nothing', () => {
    show(session([]), { tab: 'changes' });
    expect($('.gc-work-empty').textContent).toContain('No files changed in this conversation yet.');
    click(tab('Artifacts'));
    expect($('.gc-work-empty').textContent).toContain('No artifacts in this conversation yet.');
    click(tab('Tasks'));
    expect($('.gc-work-empty').textContent).toContain('No delegated tasks in this conversation.');
    // An empty tab has no count beside its name.
    expect($$('.gc-work-count')).toHaveLength(0);
  });
});

describe('<WorkPanel> Changes', () => {
  const both = () =>
    session(
      [
        { kind: 'files', paths: ['/work/app/src/a.ts'], diff: DIFF },
        { kind: 'files', paths: ['notes.md'] },
        { kind: 'files', paths: ['notes.md'] },
      ],
      [
        task('t1', { state: 'merged', changes: ['A\tsrc/cart.test.ts'] }),
        task('t2', { state: 'unmerged', changes: ['M\tsrc/b.ts', 'D\tsrc/dead.ts'] }),
      ],
    );

  it('lists the lead’s own files, then the tasks’ files with their task and whether it is merged', () => {
    show(both(), { tab: 'changes' });
    expect($$('.gc-work-label').map((item) => item.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      'Changed by claude 2 files · newest first',
      'Changed by delegated tasks 3 files',
    ]);
    expect(rows()).toEqual([
      '• editednotes.md2 edits',
      'M modifiedsrc/a.ts+2 −1',
      'M modifiedsrc/b.tst2 unmerged',
      'D deletedsrc/dead.tst2 unmerged',
      'A addedsrc/cart.test.tst1 merged',
    ]);
    // Without a viewer the lead's files are a plain list; a task's file is always a way to its task.
    expect($$('button.gc-work-frow')).toHaveLength(3);
    expect($$('.gc-work-chip').map((item) => item.textContent?.trim())).toEqual(['All 3', 'Merged 1', 'Unmerged 2']);
    click($$('.gc-work-chip')[1]);
    expect(rows().slice(2)).toEqual(['A addedsrc/cart.test.tst1 merged']);
  });

  it('opens a task’s file as the task’s detail, and comes back to Changes', () => {
    show(both(), { tab: 'changes' });
    click($$('button.gc-work-frow')[0]);
    expect(view).toMatchObject({ tab: 'tasks', task: '7:t2' });
    expect($('.gc-work-detail').getAttribute('aria-label')).toBe('Task t2');
    const back = $('.gc-work-back');
    expect(back.textContent?.trim()).toBe('Changes');
    expect(document.activeElement).toBe(back);
    click(back);
    expect(view).toMatchObject({ tab: 'changes', task: undefined });
    expect(rows()).toHaveLength(5);
  });

  it('opens the lead’s file in the host’s viewer, and back returns to the list with the focus on its row', () => {
    show(both(), { tab: 'changes' }, { renderViewer: viewer });
    expect($$('button.gc-work-frow')).toHaveLength(5);
    click($('[data-open="file:/work/app/src/a.ts"]'));
    expect(view.viewing).toEqual({ kind: 'file', path: '/work/app/src/a.ts', from: 'changes' });
    expect($('.test-viewer output').textContent).toBe('file /work/app/src/a.ts');
    // The tabs stay; the list is replaced by the viewer.
    expect($$('[role="tab"]')).toHaveLength(4);
    expect($$('.gc-work-frow')).toHaveLength(0);
    expect($('.test-viewer button').textContent).toBe('Changes');
    click($('.test-viewer button'));
    expect(view.viewing).toBeUndefined();
    expect(document.activeElement).toBe($('[data-open="file:/work/app/src/a.ts"]'));
  });

  it('leaves the files a plain list for a viewer that shows artifacts only', () => {
    show(both(), { tab: 'changes' }, { renderViewer: viewer, viewsFiles: false });
    expect($$('button.gc-work-frow')).toHaveLength(3);
  });

  it('cuts a long list to its first rows, with Show more', () => {
    const paths = Array.from({ length: 45 }, (_, index) => `src/f${index}.ts`);
    show(session([{ kind: 'files', paths }]), { tab: 'changes' });
    expect(rows()).toHaveLength(40);
    click($('.gc-work-more'));
    expect($('.gc-work-more')).toBeNull();
    expect(rows()).toHaveLength(45);
  });

  it('opens a file of a task’s detail from its worktree, and back returns to the task', () => {
    show(
      both(),
      { tab: 'tasks', task: '7:t2' },
      {
        renderViewer: viewer,
      },
    );
    // The deleted file is not there to open.
    expect($$('.gc-work-filelink').map((item) => item.textContent)).toEqual(['src/b.ts']);
    click($('.gc-work-filelink'));
    expect(view.viewing).toEqual({
      kind: 'file',
      path: '/work/app/.genaicode/worktrees/t2-k1/src/b.ts',
      from: 'task',
    });
    expect($('.test-viewer button').textContent).toBe('t2');
    click($('.test-viewer button'));
    expect($('.gc-work-detail').getAttribute('aria-label')).toBe('Task t2');
    expect(document.activeElement).toBe($('.gc-work-filelink'));
  });
  it('keeps a task’s detail as it was across a file opened from it: its diff, and the focus on the file', async () => {
    const reviewed = session(
      [],
      [task('t2', { state: 'unmerged', changes: ['M\tsrc/b.ts'], checks: { revision: 'r1' } })],
    );
    show(reviewed, { tab: 'tasks' }, { renderViewer: viewer, onPackAction: async () => DIFF });
    // Opened from its row, as the person does: the back button takes the focus.
    click($('[data-task="7:t2"] .gc-work-row'));
    expect(document.activeElement).toBe($('.gc-work-back'));
    await act(async () =>
      $$('button')
        .find((item) => item.textContent === 'Show diff')!
        .click(),
    );
    expect($$('button').some((item) => item.textContent === 'Hide diff')).toBe(true);
    click($('.gc-work-filelink'));
    expect($('.test-viewer output').textContent).toBe('file /work/app/.genaicode/worktrees/t2-k1/src/b.ts');
    // The detail waits under the viewer, out of sight.
    expect($('.gc-work-detail').closest('[hidden]')).not.toBeNull();
    click($('.test-viewer button'));
    expect($('.gc-work-detail').closest('[hidden]')).toBeNull();
    expect($$('button').some((item) => item.textContent === 'Hide diff')).toBe(true);
    expect(document.activeElement).toBe($('.gc-work-filelink'));
  });

  it('opens a merged task’s file in the chat’s folder, inside a repository, and leaves the files outside it plain', () => {
    const root = '/work/repo/.genaicode/worktrees/t1-k1';
    const state = {
      ...session(
        [{ kind: 'files', paths: ['package.json', '../../package.json'] }],
        [
          task('t1', {
            state: 'merged',
            cwd: `${root}/packages/web`,
            worktree: root,
            changes: ['M\tpackages/web/package.json', 'M\tpackage.json'],
          }),
        ],
      ),
      cwd: '/work/repo/packages/web',
    };
    show(state, { tab: 'changes' }, { renderViewer: viewer });
    // What the merge reported is the task's, not two more rows of the lead's.
    expect(rows()).toEqual(['M modifiedpackages/web/package.jsont1 merged', 'M modifiedpackage.jsont1 merged']);
    click($$('button.gc-work-frow')[0]);
    expect($$('.gc-work-filelink').map((item) => item.textContent)).toEqual(['packages/web/package.json']);
    click($('.gc-work-filelink'));
    expect($('.test-viewer output').textContent).toBe('file /work/repo/packages/web/package.json');
  });
});

describe('<WorkPanel> Artifacts', () => {
  const published = () =>
    session([
      { kind: 'artifact', artifact: artifact('a1', 1) },
      { kind: 'artifact', artifact: artifact('img', 1, { title: 'Chart', kind: 'image', mimeType: 'image/png' }) },
      { kind: 'artifact', artifact: artifact('a1', 2, { bytes: 4096 }) },
    ]);

  it('lists the artifacts with kind, size and versions, the newest first', () => {
    show(published(), { tab: 'artifacts' }, { artifactUrl: (item) => `/artifacts/${item.id}?v=${item.version}` });
    expect(rows('.gc-work-art-text')).toEqual(['Report a1Page · 4.0 KB · v2 of 2', 'ChartImage · 2.0 KB']);
    // Without a viewer each is a link to where the host serves it.
    expect($$('a.gc-work-art').map((item) => item.getAttribute('href'))).toEqual([
      '/artifacts/a1?v=2',
      '/artifacts/img?v=1',
    ]);
  });

  it('opens one in the host’s viewer; back, and another tab, close it', () => {
    show(published(), { tab: 'artifacts' }, { renderViewer: viewer });
    click($('[data-open="artifact:img"]'));
    expect(view.viewing).toEqual({ kind: 'artifact', id: 'img', from: 'artifacts' });
    expect($('.test-viewer output').textContent).toBe('artifact img');
    expect($('.test-viewer button').textContent).toBe('Artifacts');
    expect($('[role="tabpanel"]').getAttribute('data-viewing')).toBe('true');
    click($('.test-viewer button'));
    expect(view.viewing).toBeUndefined();
    expect(document.activeElement).toBe($('[data-open="artifact:img"]'));

    click($('[data-open="artifact:a1"]'));
    click(tab('Changes'));
    expect(view).toMatchObject({ tab: 'changes', viewing: undefined });
    expect($('.test-viewer')).toBeNull();
    // The tab that is selected closes the viewer too: it is the way back to its list.
    click(tab('Artifacts'));
    click($('[data-open="artifact:a1"]'));
    click(tab('Artifacts'));
    expect(view).toMatchObject({ tab: 'artifacts', viewing: undefined });
  });

  it('shows what the host opened from the chat, with Close as the way back', () => {
    show(
      published(),
      { tab: 'tasks', viewing: { kind: 'file', path: 'README.md', from: 'chat' } },
      { renderViewer: viewer },
    );
    expect($('.test-viewer output').textContent).toBe('file README.md');
    expect($('.test-viewer button').textContent).toBe('Close');
    // A host without a viewer ignores it.
    show(published(), { tab: 'artifacts', viewing: { kind: 'file', path: 'README.md', from: 'chat' } });
    expect($('.test-viewer')).toBeNull();
    expect(rows('.gc-work-art-text')).toHaveLength(2);
  });
});
