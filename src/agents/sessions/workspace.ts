import type { TokenUsage } from '../../core/types.js';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs, mkdirSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { startLocalMcpServer } from '../mcp-server.js';
import type { McpTool } from '../mcp-tools.js';
import type { ApprovalRequest, McpServer, QuestionAnswers, QuestionHandler } from '../types.js';
import { archiveKey } from './archive.js';
import { codexProjects, type CodexProject } from './codex.js';
import { homeOf, isScratchDir, promptLine } from './files.js';
import { groupSessions } from './group.js';
import { liveDir } from './live.js';
import { findTopic, readTopics, type Topic, type TopicStore } from './topics.js';
import type { SessionInfo } from './types.js';

/** The MCP tool agents call in `--home` mode to move a conversation into a project directory. */
export const OPEN_PROJECT_TOOL = 'open_project';

/** How a conversation got its working directory. */
export type ConversationOrigin = 'home' | 'topic' | 'session' | 'project' | 'unresolved';

/** One conversation tracked by the server in `--home` mode. */
export interface ConversationRecord {
  usage?: TokenUsage;
  costUsd?: number;
  id: string;
  cwd: string;
  origin: ConversationOrigin;
  title?: string;
  topicId?: string;
  topicName?: string;
  agent?: string;
  source?: string;
  sessionId?: string;
  updatedAt: number;
}

/** Result of resolving a working directory for a session or topic. */
export type WorkspaceResolution =
  | { status: 'resolved'; cwd: string; origin: Exclude<ConversationOrigin, 'unresolved'> }
  | { status: 'unresolved'; cwd: string; origin: 'unresolved'; reason?: string };

/** Filesystem and git probes used by resolution; injectable for tests. */
export interface WorkspaceDeps {
  env?: NodeJS.ProcessEnv;
  isDirectory?(dir: string): boolean;
  isFile?(target: string): boolean;
  realpath?(target: string): string;
  gitTopLevel?(dir: string): string | undefined;
  gitRemoteUrl?(dir: string): string | undefined;
  mkdir?(dir: string): Promise<void>;
}

/** Root directory for genaicode's own state (`$GENAICODE_HOME`, else `~/.genaicode`). */
export function genaicodeHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.dirname(liveDir(env));
}

/** Neutral working directory for cross-project conversations (`~/.genaicode/home`). */
export function neutralHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(genaicodeHomeDir(env), 'home');
}

/** Ensure `~/.genaicode/home` exists (empty, not a git repository) and return its path. */
export function ensureNeutralHome(env: NodeJS.ProcessEnv = process.env): string {
  const dir = neutralHomeDir(env);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Format `dir` for display, using `~` when inside the user's home directory. */
export function displayPath(dir: string, env: NodeJS.ProcessEnv = process.env): string {
  const home = stripTrailingSep(path.resolve(homeOf(env)));
  const resolved = stripTrailingSep(path.resolve(dir));
  if (resolved === home) return '~';
  if (resolved.startsWith(`${home}${path.sep}`)) return `~${resolved.slice(home.length)}`;
  return resolved;
}

/** Expand a leading `~` or `~/…` path using `env`'s home directory. */
export function expandPath(input: string, env: NodeJS.ProcessEnv = process.env): string {
  const trimmed = input.trim();
  if (trimmed === '~') return path.resolve(homeOf(env));
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return path.resolve(homeOf(env), trimmed.slice(2));
  }
  return path.resolve(trimmed);
}

/** Whether `input` is an explicit path (absolute or `~/…`), as opposed to a project or topic name. */
export function isExplicitPath(input: string): boolean {
  const trimmed = input.trim();
  return trimmed === '~' || trimmed.startsWith('~/') || trimmed.startsWith('~\\') || path.isAbsolute(trimmed);
}

/** Whether `a` and `b` name the same directory (following symlinks where they exist). */
export function isSameDir(a: string, b: string, realpath: (p: string) => string = defaultRealpath): boolean {
  return stripTrailingSep(realpath(a)) === stripTrailingSep(realpath(b));
}

/**
 * Directories genaicode must never pick automatically as a project workspace:
 * temporary/scratch dirs, `.genaicode/worktrees`, the user's home directory itself, or filesystem root.
 */
export function isDisallowedWorkspace(dir: string | undefined, deps: WorkspaceDeps = {}): boolean {
  if (!dir) return true;
  if (isScratchDir(dir)) return true;
  const env = deps.env ?? process.env;
  const real = deps.realpath ?? defaultRealpath;
  const resolved = stripTrailingSep(real(dir));
  if (!resolved || isFsRoot(resolved)) return true;
  const home = stripTrailingSep(real(homeOf(env)));
  return resolved === home;
}

/** Whether `dir` is the neutral home directory itself. */
export function isNeutralHome(dir: string | undefined, deps: WorkspaceDeps = {}): boolean {
  if (!dir) return false;
  return isSameDir(dir, neutralHomeDir(deps.env ?? process.env), deps.realpath ?? defaultRealpath);
}

/**
 * Resolve a working directory when continuing an existing session (Resolution order A.1):
 * 1. Neutral home stays neutral home.
 * 2. Session's `cwd` if it still exists and is allowed.
 * 3. Main worktree of a deleted (or active) `.claude/worktrees/*` / `.genaicode/worktrees/*`.
 * 4. Repository root (`git rev-parse --show-toplevel`) of the nearest existing parent.
 * 5. Local checkout matching `session.repository` (or Codex/Antigravity worktree repo name).
 * 6. Unresolved (runs in neutral home with `open_project` enabled).
 */
export function resolveSessionWorkspace(
  session: SessionInfo,
  options: WorkspaceDeps & {
    sessions?: readonly SessionInfo[];
    codexProjects?: readonly CodexProject[];
  } = {},
): WorkspaceResolution {
  const env = options.env ?? process.env;
  const isDir = options.isDirectory ?? defaultIsDir;
  const home = neutralHomeDir(env);

  if (session.cwd && isNeutralHome(session.cwd, options) && isDir(session.cwd)) {
    return { status: 'resolved', cwd: home, origin: 'home' };
  }

  if (session.cwd && !isDisallowedWorkspace(session.cwd, options) && isDir(session.cwd)) {
    return { status: 'resolved', cwd: session.cwd, origin: 'session' };
  }

  if (session.cwd) {
    const recovered = recoverRepoRoot(session.cwd, options);
    if (recovered) return { status: 'resolved', cwd: recovered, origin: 'session' };
  }

  const checkout = findLocalCheckout(
    session.repository,
    worktreeRepoHint(session.cwd),
    options.sessions ?? [],
    options.codexProjects ?? [],
    options,
  );
  if (checkout) return { status: 'resolved', cwd: checkout, origin: 'session' };

  return {
    status: 'unresolved',
    cwd: home,
    origin: 'unresolved',
    reason: session.cwd
      ? `Original directory ${displayPath(session.cwd, env)} is no longer available.`
      : 'This session has no local directory.',
  };
}

/**
 * Resolve a working directory for a topic (Resolution order A.2):
 * 1. `cwd` of the topic's most recent non-automated session that still exists (excluding neutral home & disallowed dirs).
 * 2. Repo root / main worktree fallback of the topic's most recent non-automated session whose `cwd` was removed.
 * 3. Existing root of a Codex desktop project mapped to this topic.
 * 4. For a topic mapped from a claude.ai project (or cloud sessions) with no local `cwd`, a local checkout of the
 *    repository its sessions name.
 * 5. Unresolved (runs in neutral home with `open_project` enabled).
 */
export function resolveTopicWorkspace(
  topicId: string,
  allSessions: readonly SessionInfo[],
  store: TopicStore,
  options: WorkspaceDeps & {
    codexProjects?: readonly CodexProject[];
  } = {},
): WorkspaceResolution {
  const env = options.env ?? process.env;
  const isDir = options.isDirectory ?? defaultIsDir;
  const home = neutralHomeDir(env);

  const memberSessions = allSessions
    .filter((session) => store.sessions[archiveKey(session)] === topicId)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const humanSessions = memberSessions.filter((session) => !session.automated && !isScratchDir(session.cwd));

  // 1. Most recent non-automated session with an existing allowed project cwd.
  for (const session of humanSessions) {
    if (!session.cwd || isNeutralHome(session.cwd, options) || isDisallowedWorkspace(session.cwd, options)) continue;
    if (isDir(session.cwd)) return { status: 'resolved', cwd: session.cwd, origin: 'topic' };
  }

  // 2. Deleted cwd / deleted worktree recovery on non-automated sessions.
  for (const session of humanSessions) {
    if (!session.cwd || isNeutralHome(session.cwd, options)) continue;
    const recovered = recoverRepoRoot(session.cwd, options);
    if (recovered && !isNeutralHome(recovered, options)) {
      return { status: 'resolved', cwd: recovered, origin: 'topic' };
    }
  }

  // 3. Codex desktop project mapped to this topic in `store.projects`.
  const codex = options.codexProjects ?? [];
  if (store.projects && codex.length) {
    for (const [key, mappedTopicId] of Object.entries(store.projects)) {
      if (mappedTopicId !== topicId || !key.startsWith('codex:')) continue;
      const project = codex.find((candidate) => `codex:${candidate.id}` === key);
      const existing = project?.roots.find(
        (root) => !isNeutralHome(root, options) && !isDisallowedWorkspace(root, options) && isDir(root),
      );
      if (existing) return { status: 'resolved', cwd: existing, origin: 'topic' };
    }
  }

  // 4. Repository named by sessions of this topic (e.g. claude.ai project without local cwd).
  for (const session of humanSessions) {
    if (!session.repository) continue;
    const checkout = findLocalCheckout(session.repository, undefined, allSessions, codex, options);
    if (checkout) return { status: 'resolved', cwd: checkout, origin: 'topic' };
  }

  return {
    status: 'unresolved',
    cwd: home,
    origin: 'unresolved',
    reason: 'No existing local directory was found for this topic.',
  };
}

/**
 * Recover the main repository root from a deleted `cwd` or worktree path:
 * - Main worktree of `.claude/worktrees/*` or `.genaicode/worktrees/*`.
 * - `git rev-parse --show-toplevel` on the nearest existing parent.
 */
function recoverRepoRoot(cwd: string, deps: WorkspaceDeps): string | undefined {
  const isDir = deps.isDirectory ?? defaultIsDir;
  const topLevel = deps.gitTopLevel ?? defaultGitTopLevel;

  // Main worktree of `.claude/worktrees/*` or `.genaicode/worktrees/*`.
  const normalized = cwd.replace(/\\/g, '/');
  const worktreeMatch = /^(.*?)\/\.(?:claude|genaicode)\/worktrees(?:\/|$)/.exec(normalized);
  if (worktreeMatch?.[1]) {
    const main = path.resolve(worktreeMatch[1]);
    if (isDir(main) && !isDisallowedWorkspace(main, deps)) {
      const top = topLevel(main);
      if (top && isDir(top) && !isDisallowedWorkspace(top, deps)) return top;
      return main;
    }
  }

  // Walk up to nearest existing parent (never running git at home dir or filesystem root).
  let current = path.dirname(path.resolve(cwd));
  for (let depth = 0; depth < 32; depth += 1) {
    if (isFsRoot(current)) break;
    if (isDir(current)) {
      if (isDisallowedWorkspace(current, deps)) return undefined;
      const top = topLevel(current);
      if (top && isDir(top) && !isDisallowedWorkspace(top, deps)) return top;
      return undefined;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}

/** Repo name hint from an external agent worktree path (`.codex/worktrees/<id>/<repo>`, Antigravity worktrees). */
function worktreeRepoHint(cwd: string | undefined): string | undefined {
  if (!cwd) return undefined;
  const flat = cwd.replace(/\\/g, '/');
  return (
    /\/\.codex\/worktrees\/[^/]+\/([^/]+)/.exec(flat)?.[1] ??
    /\/\.gemini\/antigravity\/worktrees\/([^/]+)\//.exec(flat)?.[1]
  );
}

/** Normalize a git remote URL or `owner/repo` string for comparison. */
export function normalizeRepo(repo: string | undefined): string | undefined {
  if (!repo) return undefined;
  let text = repo.trim().toLowerCase();
  if (!text) return undefined;
  text = text.replace(/\.git$/, '').replace(/\/+$/, '');
  const ssh = /^git@[^:]+:(.+)$/.exec(text);
  if (ssh?.[1]) return ssh[1];
  const url = /^[a-z][a-z0-9+.-]*:\/\/[^/]+\/(.+)$/.exec(text);
  if (url?.[1]) return url[1];
  return text;
}

/** Last path segment of a repository identifier (e.g. `gtanczyk/knights` -> `knights`). */
function repoBaseName(repo: string): string | undefined {
  return repo.split('/').filter(Boolean).pop();
}

/** Find an existing local checkout matching `repository` or `repoNameHint` among known sessions and Codex roots. */
function findLocalCheckout(
  repository: string | undefined,
  repoNameHint: string | undefined,
  allSessions: readonly SessionInfo[],
  codex: readonly CodexProject[],
  deps: WorkspaceDeps,
): string | undefined {
  const wanted = normalizeRepo(repository);
  const wantedName = (wanted ? repoBaseName(wanted) : undefined) ?? repoNameHint?.toLowerCase();
  if (!wanted && !wantedName) return undefined;
  const isDir = deps.isDirectory ?? defaultIsDir;
  const remoteOf = deps.gitRemoteUrl ?? defaultGitRemoteUrl;

  const usable = (dir: string | undefined): dir is string =>
    !!dir && !isNeutralHome(dir, deps) && !isDisallowedWorkspace(dir, deps) && isDir(dir);

  // 1. Exact repository match recorded on an existing local non-automated session.
  const sorted = [...allSessions]
    .filter((session) => !session.automated && usable(session.cwd))
    .sort((a, b) => b.updatedAt - a.updatedAt);

  if (wanted) {
    for (const session of sorted) {
      if (normalizeRepo(session.repository) === wanted) return session.cwd!;
    }
  }

  // 2. Check git remote of candidate directories (session cwds, Codex roots, ~/src/<name>).
  const candidates: string[] = [];
  const seen = new Set<string>();
  const add = (dir: string | undefined) => {
    if (!usable(dir)) return;
    const key = stripTrailingSep(path.resolve(dir));
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(dir);
  };
  for (const session of sorted) add(session.cwd);
  for (const project of codex) for (const root of project.roots) add(root);
  if (wantedName) add(path.join(homeOf(deps.env ?? process.env), 'src', wantedName));

  if (wanted) {
    for (const dir of candidates) {
      if (normalizeRepo(remoteOf(dir)) === wanted) return dir;
    }
  }

  // 3. Unambiguous basename match when we only have a worktree repo name hint (e.g. `.codex/worktrees/<id>/knights`).
  if (!wanted && wantedName) {
    const matches = candidates.filter((dir) => path.basename(dir).toLowerCase() === wantedName);
    if (matches.length === 1) return matches[0];
  }
  return undefined;
}

/** Resolved target of an `open_project({ path | topic })` call. */
export type ProjectTarget = { cwd: string; exists: boolean; topic?: Topic } | { error: string };

/**
 * Resolve `open_project({ path | topic })` arguments to a concrete directory path.
 * Accepts an absolute or `~/…` path, a topic id/name, a Codex project name, or a known project folder name.
 */
export function resolveProjectTarget(
  input: { path?: string; topic?: string },
  context: WorkspaceDeps & {
    store?: TopicStore;
    sessions?: readonly SessionInfo[];
    codexProjects?: readonly CodexProject[];
  } = {},
): ProjectTarget {
  const env = context.env ?? process.env;
  const isDir = context.isDirectory ?? defaultIsDir;
  const isFile = context.isFile ?? defaultIsFile;
  const rawPath = typeof input.path === 'string' ? input.path.trim() : '';
  const rawTopic = typeof input.topic === 'string' ? input.topic.trim() : '';

  if (!rawPath && !rawTopic)
    return { error: 'Give either "path" (absolute or ~/…) or "topic" (topic or project name).' };
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(rawPath) || /[\x00-\x1f\x7f]/.test(rawTopic)) {
    return { error: 'Invalid control characters in path or topic.' };
  }

  // Explicit path (`~/…` or absolute).
  if (rawPath && isExplicitPath(rawPath)) {
    const target = expandPath(rawPath, env);
    if (isFsRoot(target) || isSameDir(target, homeOf(env), context.realpath ?? defaultRealpath)) {
      return { error: 'Cannot open the home directory or filesystem root as a project. Give a project directory.' };
    }
    if (isFile(target)) return { error: `${displayPath(target, env)} is a file, not a directory.` };
    const matchedTopic = matchTopicForDir(
      target,
      context.store,
      context.sessions ?? [],
      context.codexProjects ?? [],
      context,
    );
    return { cwd: target, exists: isDir(target), ...(matchedTopic ? { topic: matchedTopic } : {}) };
  }

  // Name lookup (topic name/id, Codex desktop project name, or known session project directory name).
  const query = rawTopic || rawPath;
  const store = context.store ?? { topics: [], sessions: {} };
  const sessions = context.sessions ?? [];
  const codex = context.codexProjects ?? [];

  // 1. Known topic.
  const topic = findTopic(store, query);
  if (topic) {
    const resolved = resolveTopicWorkspace(topic.id, sessions, store, { ...context, codexProjects: codex });
    if (resolved.status === 'resolved') return { cwd: resolved.cwd, exists: true, topic };
    return {
      error: `Topic "${topic.name}" has no existing local directory. Ask the user for a path (e.g. ~/src/…).`,
    };
  }

  // 2. Codex desktop project by exact or unique substring name.
  const lower = query.toLowerCase();
  const codexMatch =
    codex.find((project) => project.name.toLowerCase() === lower) ??
    (() => {
      const partial = codex.filter((project) => project.name.toLowerCase().includes(lower));
      return partial.length === 1 ? partial[0] : undefined;
    })();
  if (codexMatch) {
    const root = codexMatch.roots.find(
      (dir) => !isNeutralHome(dir, context) && !isDisallowedWorkspace(dir, context) && isDir(dir),
    );
    if (root) {
      const linkedTopic = matchTopicForDir(root, store, sessions, codex, context);
      return { cwd: root, exists: true, ...(linkedTopic ? { topic: linkedTopic } : {}) };
    }
  }

  // 3. Known project folder from local non-automated sessions (exact folder name, then substring).
  const projects = groupSessions(
    sessions.filter(
      (session) =>
        !session.automated &&
        session.where === 'local' &&
        !!session.cwd &&
        !isNeutralHome(session.cwd, context) &&
        !isDisallowedWorkspace(session.cwd, context) &&
        isDir(session.cwd),
    ),
  );
  const projectMatch =
    projects.find((project) => project.name.toLowerCase() === lower) ??
    projects.find((project) => project.name.toLowerCase().includes(lower));
  if (projectMatch?.key) {
    const linkedTopic = matchTopicForDir(projectMatch.key, store, sessions, codex, context);
    return { cwd: projectMatch.key, exists: true, ...(linkedTopic ? { topic: linkedTopic } : {}) };
  }

  return { error: `No topic or known project named "${query}". Give an absolute or ~/… path instead.` };
}

/** Find a topic associated with `dir` via existing sessions or Codex project mapping, if unambiguous. */
function matchTopicForDir(
  dir: string,
  store: TopicStore | undefined,
  sessions: readonly SessionInfo[],
  codex: readonly CodexProject[],
  deps: WorkspaceDeps,
): Topic | undefined {
  if (!store?.topics.length) return undefined;
  const real = deps.realpath ?? defaultRealpath;
  if (store.projects) {
    for (const project of codex) {
      const topicId = store.projects[`codex:${project.id}`];
      if (!topicId) continue;
      if (project.roots.some((root) => isSameDir(root, dir, real))) {
        const found = store.topics.find((topic) => topic.id === topicId);
        if (found) return found;
      }
    }
  }
  const recent = [...sessions]
    .filter((session) => !session.automated && session.cwd && isSameDir(session.cwd, dir, real))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  for (const session of recent) {
    const topicId = store.sessions[archiveKey(session)];
    if (!topicId) continue;
    const found = store.topics.find((topic) => topic.id === topicId);
    if (found) return found;
  }
  return undefined;
}

/** Context needed by `open_project` to resolve names, ask the user, and move the conversation. */
export interface OpenProjectToolOptions extends WorkspaceDeps {
  /** Returns the current question handler (`AgentSession` binds this while a turn runs). */
  ask(): QuestionHandler | undefined;
  /** Called only after the user explicitly confirms moving to `target`. */
  onMove(target: { cwd: string; topic?: Topic }): void | Promise<void>;
  /** Loads topics, sessions and Codex projects on demand for name resolution. */
  loadContext?(): Promise<{
    store: TopicStore;
    sessions: readonly SessionInfo[];
    codexProjects: readonly CodexProject[];
  }>;
}

const YES_CONTINUE = 'Yes';
const YES_CREATE = 'Create and continue';
const NO_STAY = 'No';

/**
 * `open_project`: moves a conversation from the neutral home (or an unresolved directory) into a
 * project directory, only after the person confirms through a question card.
 */
export function openProjectTool(options: OpenProjectToolOptions): McpTool {
  return {
    name: OPEN_PROJECT_TOOL,
    _meta: { 'anthropic/alwaysLoad': true },
    description:
      'Move this conversation into a project directory so you can read, edit and run commands there. ' +
      'Call this when the user asks to work on a project, names a topic or project (e.g. "knights"), ' +
      'or gives a directory path (e.g. "~/src/my-app"). Pass `path` (absolute or ~/…) or `topic` ' +
      '(a topic or project name). The user sees a confirmation card before the conversation moves; ' +
      'if the directory does not exist, they are offered to create it. On confirmation, the next turn ' +
      'runs in that directory with a recap of this conversation so far.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path or ~/… path of the project directory.' },
        topic: { type: 'string', description: 'Topic name, topic id, or known project name.' },
      },
    },
    async call(args) {
      const env = options.env ?? process.env;
      const loaded = options.loadContext ? await options.loadContext().catch(() => undefined) : undefined;
      const target = resolveProjectTarget(
        {
          path: typeof args.path === 'string' ? args.path : undefined,
          topic: typeof args.topic === 'string' ? args.topic : undefined,
        },
        {
          ...options,
          env,
          store: loaded?.store,
          sessions: loaded?.sessions,
          codexProjects: loaded?.codexProjects,
        },
      );
      if ('error' in target) return target.error;

      const handler = options.ask();
      if (!handler) return 'Cannot ask the user to confirm right now. Stay in the current directory.';

      const shown = displayPath(target.cwd, env);
      const confirmLabel = target.exists ? YES_CONTINUE : YES_CREATE;
      const questionText = target.exists
        ? `Continue this conversation in ${shown}?`
        : `${shown} does not exist. Create it and continue this conversation there?`;

      const request: ApprovalRequest = {
        id: `open-project-${randomUUID()}`,
        kind: 'question',
        scope: 'once',
        summary: questionText,
        detail: {
          tool: OPEN_PROJECT_TOOL,
          path: target.cwd,
          exists: target.exists,
          ...(target.topic ? { topic: target.topic.name } : {}),
        },
        questions: [
          {
            id: 'confirm',
            header: target.exists ? 'Project' : 'New project',
            question: questionText,
            options: [
              {
                label: confirmLabel,
                description: target.exists
                  ? `Move this conversation to ${shown}`
                  : `Create ${shown} and move this conversation there`,
              },
              {
                label: NO_STAY,
                description: target.exists ? 'Stay where you are' : 'Stay here without creating anything',
              },
            ],
          },
        ],
      };

      let answers: QuestionAnswers | undefined;
      try {
        answers = await handler(request);
      } catch {
        answers = undefined;
      }
      const picked = answers?.confirm?.[0];
      if (picked !== confirmLabel) {
        return `The user declined to move to ${shown}. Stay in the current directory.`;
      }

      if (!target.exists) {
        try {
          const makeDir = options.mkdir ?? ((dir) => fs.mkdir(dir, { recursive: true }).then(() => undefined));
          await makeDir(target.cwd);
        } catch (error) {
          return `Could not create ${shown}: ${error instanceof Error ? error.message : String(error)}`;
        }
      }

      await options.onMove({ cwd: target.cwd, ...(target.topic ? { topic: target.topic } : {}) });
      return (
        `Moved this conversation to ${shown}. ` +
        'The current turn is still running in the previous directory, so do not edit project files yet; ' +
        `the next turn will start in ${shown} with a recap of this conversation so far. ` +
        'Tell the user you are ready there.'
      );
    },
  };
}

/** Running MCP server exposing `open_project` when the conversation is in neutral home or unresolved. */
export interface ProjectChannel {
  mcpServer: McpServer;
  /** Whether `open_project` should be offered on the next turn. */
  enabled(): boolean;
  /** Who shows the confirmation card while a turn runs; `undefined` between turns. */
  bind(handler: QuestionHandler | undefined): void;
  close(): Promise<void>;
}

/** Start a local MCP server serving `open_project`, behind a random bearer token. */
export async function startProjectChannel(options: {
  serve?: typeof startLocalMcpServer;
  name?: string;
  env?: NodeJS.ProcessEnv;
  loadSessions?(): Promise<readonly SessionInfo[]>;
  enabled(): boolean;
  onMove(target: { cwd: string; topic?: Topic }): void | Promise<void>;
}): Promise<ProjectChannel> {
  let handler: QuestionHandler | undefined;
  const tool = openProjectTool({
    env: options.env,
    ask: () => handler,
    onMove: options.onMove,
    async loadContext() {
      const env = options.env;
      const [store, sessions, codex] = await Promise.all([
        readTopics(env).catch(() => ({ topics: [], sessions: {} })),
        options.loadSessions ? options.loadSessions().catch(() => [] as SessionInfo[]) : Promise.resolve([]),
        codexProjects({ env }).catch(() => []),
      ]);
      return { store, sessions, codexProjects: codex };
    },
  });
  const server = await (options.serve ?? startLocalMcpServer)({
    name: options.name ?? 'genaicode_project',
    tools: [tool],
    instructions:
      `Use ${OPEN_PROJECT_TOOL} when the user wants to work in a project, mentions a directory path ` +
      '(such as ~/src/…) or names a topic/project. It asks the user to confirm before moving.',
  });
  return {
    mcpServer: { ...server.mcpServer, toolTimeoutSec: 86_400, trusted: true },
    enabled: options.enabled,
    bind(next) {
      handler = next;
    },
    close: server.close,
  };
}

/** Where the desktop/`--home` conversation list is kept (`~/.genaicode/conversations.json`). */
export function conversationsFile(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(genaicodeHomeDir(env), 'conversations.json');
}

const MAX_CONVERSATIONS = 200;
const VALID_ORIGINS = new Set<ConversationOrigin>(['home', 'topic', 'session', 'project', 'unresolved']);

const conversationQueues = new Map<string, Promise<void>>();

async function readConversationsUnlocked(file: string): Promise<ConversationRecord[]> {
  try {
    const raw: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
    if (!Array.isArray(raw)) return [];
    return raw
      .flatMap((item): ConversationRecord[] => {
        if (!item || typeof item !== 'object') return [];
        const rec = item as Record<string, unknown>;
        if (
          typeof rec.id !== 'string' ||
          typeof rec.cwd !== 'string' ||
          typeof rec.origin !== 'string' ||
          !VALID_ORIGINS.has(rec.origin as ConversationOrigin) ||
          typeof rec.updatedAt !== 'number'
        )
          return [];
        return [
          {
            id: rec.id,
            cwd: rec.cwd,
            origin: rec.origin as ConversationOrigin,
            ...(typeof rec.title === 'string' && promptLine(rec.title, 120)
              ? { title: promptLine(rec.title, 120) }
              : {}),
            ...(typeof rec.topicId === 'string' ? { topicId: rec.topicId } : {}),
            ...(typeof rec.topicName === 'string' ? { topicName: rec.topicName } : {}),
            ...(typeof rec.agent === 'string' ? { agent: rec.agent } : {}),
            ...(typeof rec.source === 'string' ? { source: rec.source } : {}),
            ...(typeof rec.sessionId === 'string' ? { sessionId: rec.sessionId } : {}),
            ...(typeof rec.costUsd === 'number' && rec.costUsd >= 0 ? { costUsd: rec.costUsd } : {}),
            ...(rec.usage && typeof rec.usage === 'object'
              ? {
                  usage: Object.fromEntries(
                    Object.entries(rec.usage).filter(
                      ([key, value]) =>
                        ['inputTokens', 'outputTokens', 'totalTokens', 'cachedInputTokens'].includes(key) &&
                        typeof value === 'number' &&
                        Number.isFinite(value) &&
                        value >= 0,
                    ),
                  ),
                }
              : {}),
            updatedAt: rec.updatedAt,
          },
        ];
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

/**
 * The recorded conversation a session is, if any: the same id in the same store, or the same id of
 * the same agent (read through another of its stores). An id alone says nothing, as two agents'
 * stores may both hold it.
 */
export function recordedConversation(
  recorded: readonly ConversationRecord[],
  session: Pick<SessionInfo, 'source' | 'agent' | 'id'>,
): ConversationRecord | undefined {
  return recorded.find(
    (conv) =>
      !!conv.sessionId &&
      conv.sessionId === session.id &&
      ((!!conv.source && conv.source === session.source) || (!!conv.agent && conv.agent === session.agent)),
  );
}

/** Read recorded conversations, newest first. Empty when missing or unreadable. */
export async function readConversations(env: NodeJS.ProcessEnv = process.env): Promise<ConversationRecord[]> {
  const file = path.resolve(conversationsFile(env));
  await conversationQueues.get(file)?.catch(() => undefined);
  return readConversationsUnlocked(file);
}

/** Insert or update one conversation record in `~/.genaicode/conversations.json`. */
export async function saveConversation(
  record: ConversationRecord,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const file = path.resolve(conversationsFile(env));
  const previous = conversationQueues.get(file) ?? Promise.resolve();
  const run = previous
    .catch(() => undefined)
    .then(async () => {
      const existing = await readConversationsUnlocked(file);
      const cleaned: ConversationRecord = {
        ...record,
        ...(record.title && promptLine(record.title, 120) ? { title: promptLine(record.title, 120) } : {}),
      };
      const next = [cleaned, ...existing.filter((item) => item.id !== record.id)]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, MAX_CONVERSATIONS);
      await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      const tmp = `${file}.${process.pid}.${Math.random().toString(16).slice(2, 8)}.tmp`;
      await fs.writeFile(tmp, `${JSON.stringify(next, null, 1)}\n`, { mode: 0o600 });
      await fs.rename(tmp, file);
    });
  conversationQueues.set(file, run);
  try {
    await run;
  } finally {
    if (conversationQueues.get(file) === run) conversationQueues.delete(file);
  }
}

function defaultIsDir(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function defaultIsFile(target: string): boolean {
  try {
    return statSync(target).isFile();
  } catch {
    return false;
  }
}

function defaultRealpath(target: string): string {
  try {
    return realpathSync(target);
  } catch {
    return path.resolve(target);
  }
}

function defaultGitTopLevel(dir: string): string | undefined {
  try {
    const out = execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2_000,
    }).trim();
    return out || undefined;
  } catch {
    return undefined;
  }
}

function defaultGitRemoteUrl(dir: string): string | undefined {
  try {
    const out = execFileSync('git', ['-C', dir, 'remote', 'get-url', 'origin'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2_000,
    }).trim();
    return out || undefined;
  } catch {
    return undefined;
  }
}

function stripTrailingSep(dir: string): string {
  const root = path.parse(dir).root;
  let end = dir.length;
  while (end > root.length && (dir[end - 1] === '/' || dir[end - 1] === '\\')) end -= 1;
  return dir.slice(0, end);
}

function isFsRoot(dir: string): boolean {
  const parsed = path.parse(dir);
  return stripTrailingSep(dir) === stripTrailingSep(parsed.root);
}
