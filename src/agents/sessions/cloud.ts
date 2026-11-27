import { execFile } from 'node:child_process';
import type { SessionInfo, SessionQuery, SessionSource } from './types.js';

/** Runs a program and resolves to what it printed; rejects with its errno kept (`ENOENT`: not installed). */
export type RunCommand = (command: string, args: readonly string[], signal?: AbortSignal) => Promise<string>;

const DAY_MS = 24 * 60 * 60 * 1000;
/** How far back a listing without `since` looks. */
const DEFAULT_SINCE_MS = 14 * DAY_MS;
/** Pull requests asked of GitHub at most: three pages of a hundred. */
const MAX_PAGES = 3;

function runner(env: NodeJS.ProcessEnv | undefined): RunCommand {
  return (command, args, signal) =>
    new Promise((resolve, reject) => {
      execFile(
        command,
        [...args],
        { env: env ?? process.env, timeout: 30_000, maxBuffer: 32 * 1024 * 1024, ...(signal ? { signal } : {}) },
        (error, stdout, stderr) => {
          if (!error) return resolve(String(stdout));
          const said = String(stderr).trim().split('\n').pop();
          reject(
            Object.assign(new Error(said || error.message), typeof error.code === 'string' ? { code: error.code } : {}),
          );
        },
      );
    });
}

/** A program that is not installed lists nothing; anything else it fails with is an error to show. */
async function unlessMissing<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw error;
  }
}

interface GitHubIssue {
  html_url?: string;
  number?: number;
  title?: string;
  state?: string;
  draft?: boolean;
  body?: string | null;
  created_at?: string;
  updated_at?: string;
  repository_url?: string;
  pull_request?: { merged_at?: string | null };
}

// How a cloud session signs the pull requests it opens: the claude.ai project thread it worked
// for, or the Claude Code session itself; Codex Cloud links its task.
const CLAUDE_THREAD = /https:\/\/claude\.ai\/code\/project\/(chan_[A-Za-z0-9]+)\?thread=(cmsg_[A-Za-z0-9]+)/;
const CLAUDE_SESSION = /https:\/\/claude\.ai\/code\/(session_[A-Za-z0-9]+)/;
const CODEX_TASK = /https:\/\/chatgpt\.com\/codex\/(?:cloud\/)?tasks\/(task_[A-Za-z0-9_]+)/;

/** The cloud session a pull request's description names, when it names one. */
export function cloudSessionOf(
  body: string,
): { agent: 'claude' | 'codex'; id: string; url: string; project?: string } | undefined {
  const thread = CLAUDE_THREAD.exec(body);
  // A project thread first: it outlives the sessions that work for it.
  if (thread) return { agent: 'claude', id: thread[2]!, url: thread[0], project: thread[1]! };
  const session = CLAUDE_SESSION.exec(body);
  if (session) return { agent: 'claude', id: session[1]!, url: session[0] };
  const task = CODEX_TASK.exec(body);
  if (task) return { agent: 'codex', id: task[1]!, url: task[0] };
  return undefined;
}

export interface GitHubCloudOptions {
  /** The GitHub CLI. Default `gh`, signed in as the user. */
  command?: string;
  env?: NodeJS.ProcessEnv;
  run?: RunCommand;
  now?: () => number;
}

/**
 * Cloud sessions as GitHub shows them: the user's own pull requests of late, grouped by the
 * session their description links (a claude.ai project thread, a Claude Code cloud session, a
 * Codex Cloud task). The vendors offer no listing of these sessions, but a session that pushed
 * work signs it. One that pushed nothing is not seen. Asks GitHub through `gh`, with the
 * user's own sign-in; without `gh` it lists nothing.
 */
export function githubCloudSessions(options: GitHubCloudOptions = {}): SessionSource {
  const name = 'github';
  const command = options.command ?? 'gh';
  const now = options.now ?? Date.now;
  return {
    name,
    where: 'cloud',
    async list(query: SessionQuery = {}) {
      // A local directory names no cloud session.
      if (query.cwd !== undefined) return [];
      const run = options.run ?? runner(options.env ?? query.env);
      const since = query.since ?? now() - DEFAULT_SINCE_MS;
      const day = new Date(since).toISOString().slice(0, 10);
      const found = new Map<string, SessionInfo & { pulls: string[] }>();
      for (let page = 1; page <= MAX_PAGES; page++) {
        const args = [
          'api',
          '-X',
          'GET',
          'search/issues',
          '-f',
          `q=is:pr author:@me updated:>=${day}`,
          '-f',
          'sort=updated',
          '-f',
          'per_page=100',
          '-f',
          `page=${page}`,
        ];
        const text = await unlessMissing(() => run(command, args, query.signal), undefined);
        if (text === undefined) return [];
        const items = (JSON.parse(text) as { items?: readonly GitHubIssue[] }).items ?? [];
        for (const item of items) {
          const updated = item.updated_at ? Date.parse(item.updated_at) : NaN;
          const session = cloudSessionOf(item.body ?? '');
          if (!session || !Number.isFinite(updated) || updated < since) continue;
          const repository = item.repository_url?.split('/repos/')[1];
          const merged = Boolean(item.pull_request?.merged_at);
          const open = item.state === 'open';
          const state = open ? (item.draft ? 'Draft' : 'Open') : merged ? 'Merged' : 'Closed';
          const ref: NonNullable<SessionInfo['pullRequests']>[number] | undefined =
            repository &&
            /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(repository) &&
            item.number &&
            Number.isSafeInteger(item.number) &&
            item.number > 0
              ? { repository, number: item.number, title: item.title ?? '', state }
              : undefined;
          const says = `${state}: ${repository ?? ''}#${item.number ?? '?'} ${item.title ?? ''}`;
          const key = `${session.agent}:${session.id}`;
          const known = found.get(key);
          if (known) {
            // Newest first from GitHub: the first pull request seen names the session.
            known.pulls.push(says);
            if (ref && (known.pullRequests?.length ?? 0) < 5) (known.pullRequests ??= []).push(ref);
            if (open) known.state = 'waiting';
            const started = item.created_at ? Date.parse(item.created_at) : NaN;
            if (Number.isFinite(started) && started < (known.startedAt ?? Infinity)) known.startedAt = started;
            continue;
          }
          const started = item.created_at ? Date.parse(item.created_at) : NaN;
          found.set(key, {
            source: name,
            agent: session.agent,
            id: session.id,
            where: 'cloud',
            updatedAt: updated,
            ...(Number.isFinite(started) ? { startedAt: started } : {}),
            ...(repository ? { repository } : {}),
            ...(item.title ? { title: item.title } : {}),
            url: session.url,
            ...(session.project ? { project: { id: session.project } } : {}),
            // An open pull request is work that waits: for review, for checks, for a merge.
            ...(open ? { state: 'waiting' as const } : {}),
            ...(ref ? { pullRequests: [ref] } : {}),
            pulls: [says],
          });
        }
        if (items.length < 100) break;
      }
      return [...found.values()]
        .map(({ pulls, ...session }) => ({ ...session, lastReply: pulls.slice(0, 5).join('; ') }))
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, query.limit);
    },
  };
}

interface CodexCloudTask {
  id?: string;
  url?: string;
  title?: string;
  status?: string;
  updated_at?: string;
  environment_label?: string;
}

export interface CodexCloudOptions {
  /** The Codex CLI. Default `codex`, signed in as the user. */
  command?: string;
  env?: NodeJS.ProcessEnv;
  run?: RunCommand;
}

/**
 * Codex Cloud tasks, as `codex cloud list --json` gives them (experimental in Codex): the latest
 * twenty. Without the Codex CLI it lists nothing.
 */
export function codexCloudSessions(options: CodexCloudOptions = {}): SessionSource {
  const name = 'codex-cloud';
  const command = options.command ?? 'codex';
  return {
    name,
    where: 'cloud',
    async list(query: SessionQuery = {}) {
      if (query.cwd !== undefined) return [];
      const run = options.run ?? runner(options.env ?? query.env);
      const text = await unlessMissing(() => run(command, ['cloud', 'list', '--json'], query.signal), undefined);
      if (text === undefined) return [];
      // Codex may print a warning before the JSON.
      const parsed = JSON.parse(text.slice(Math.max(0, text.search(/[[{]/)))) as
        | readonly CodexCloudTask[]
        | { tasks?: readonly CodexCloudTask[] };
      const tasks: readonly CodexCloudTask[] = Array.isArray(parsed)
        ? parsed
        : ((parsed as { tasks?: readonly CodexCloudTask[] }).tasks ?? []);
      const sessions: SessionInfo[] = [];
      for (const task of tasks) {
        const updated = task.updated_at ? Date.parse(task.updated_at) : NaN;
        if (!task.id || !Number.isFinite(updated) || (query.since !== undefined && updated < query.since)) continue;
        const working = task.status === 'pending' || task.status === 'in_progress' || task.status === 'running';
        sessions.push({
          source: name,
          agent: 'codex',
          id: task.id,
          where: 'cloud',
          updatedAt: updated,
          ...(task.title ? { title: task.title } : {}),
          ...(task.url ? { url: task.url } : {}),
          ...(task.environment_label ? { repository: task.environment_label } : {}),
          state: working ? 'active' : 'waiting',
          ...(task.status ? { lastReply: `Codex Cloud: ${task.status}` } : {}),
        });
      }
      return sessions.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, query.limit);
    },
  };
}

/**
 * `pulls` (`githubCloudSessions()`) and `tasks` (`codexCloudSessions()`) as sources that name a
 * session once where they are listed together, as `listSessions()` does with one query: a Codex
 * Cloud task that also opened a pull request is listed by `tasks`, with its pull requests and the
 * later of the two times, and left out of `pulls`. Listed alone, each gives all it has. When one
 * of the two cannot be read, the other still lists.
 */
export function joinedCloudSessions(pulls: SessionSource, tasks: SessionSource): [SessionSource, SessionSource] {
  type Look = { pulls?: Promise<SessionInfo[]>; tasks?: Promise<SessionInfo[]> };
  // One listing asks every source with the same query, before any of them answers.
  const looks = new WeakMap<SessionQuery, Look>();
  const lookOf = (query: SessionQuery): Look => {
    const known = looks.get(query);
    if (known) return known;
    const look: Look = {};
    looks.set(query, look);
    return look;
  };
  // The limit comes after the two are told apart.
  const whole = (query: SessionQuery): SessionQuery => {
    const rest = { ...query };
    delete rest.limit;
    return rest;
  };
  const key = (session: SessionInfo) => `${session.agent}:${session.id}`;
  return [
    {
      ...pulls,
      async list(query: SessionQuery = {}) {
        const look = lookOf(query);
        const own = await (look.pulls = pulls.list(whole(query)));
        const listed = new Set(look.tasks ? (await look.tasks.catch(() => [])).map(key) : []);
        return own.filter((session) => !listed.has(key(session))).slice(0, query.limit);
      },
    },
    {
      ...tasks,
      async list(query: SessionQuery = {}) {
        const look = lookOf(query);
        const own = await (look.tasks = tasks.list(whole(query)));
        const opened = new Map(
          look.pulls ? (await look.pulls.catch(() => [])).map((session) => [key(session), session]) : [],
        );
        return own
          .map((task): SessionInfo => {
            const pull = opened.get(key(task));
            if (!pull) return task;
            const says = [task.lastReply, pull.lastReply].filter(Boolean).join('; ');
            return {
              ...task,
              ...(pull.pullRequests ? { pullRequests: pull.pullRequests } : {}),
              updatedAt: Math.max(task.updatedAt, pull.updatedAt),
              ...(pull.repository ? { repository: pull.repository } : {}),
              ...(pull.startedAt !== undefined ? { startedAt: pull.startedAt } : {}),
              ...(says ? { lastReply: says } : {}),
            };
          })
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, query.limit);
      },
    },
  ];
}
