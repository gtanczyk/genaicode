import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import type { SessionInfo, SessionQuery, SessionSource } from './types.js';
import { HOOK_AGENTS, hooksStatus, type HookAgent } from './hooks.js';
import { readLive } from './live.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Fewer sessions than this say too little about a store to call its format changed. */
const MIN_FOR_SHARES = 5;
/** Readers fill in the latest prompt of about this many newest sessions; older ones may lack it. */
const JUDGED = 200;

/** How well one source reads its store right now. Counts only: nothing of what was said. */
export interface SessionCheck {
  source: string;
  where: 'local' | 'cloud';
  /** The agent's CLI version found on this machine, when a `version` lookup was given. */
  version?: string;
  /** The CLI version this source's reader was last checked against. */
  verified?: string;
  /** The CLI here is newer than `verified`: its store may have changed since. */
  newer: boolean;
  /** Sessions listed in the period. */
  listed: number;
  /** How many of them have a prompt or a title, a directory, a state. */
  withPrompt: number;
  withCwd: number;
  withState: number;
  /** Conversations opened (the newest ones), where the source can read them. */
  sampled: number;
  /** Of those: gave at least one turn, have an agent's message, have a tool call. */
  read: number;
  withReply: number;
  withTools: number;
  /** Hooks of this agent, where it has them. */
  hooks?: { installed: boolean; reported: number };
  /** What looks broken. Empty when the source is fine. */
  problems: string[];
  /** Worth knowing, not broken. */
  notes: string[];
}

export interface SessionCheckOptions {
  env?: NodeJS.ProcessEnv;
  /** Look at sessions active at or after this time. Default: the last 30 days. */
  since?: number;
  /** How many conversations to open per source. Default 5. */
  sample?: number;
  /** The CLI version of a source's agent on this machine, e.g. `cliVersion()` of its command. */
  version?: (source: SessionSource) => Promise<string | undefined>;
  now?: number;
  signal?: AbortSignal;
}

/**
 * Check that each source still reads its agent's store: how many sessions it lists, how many of
 * them have what a listing needs, and whether the newest conversations open. An agent's update can
 * change its store without notice; this is how to see it. The result holds counts only.
 */
export async function checkSessions(
  sources: readonly SessionSource[],
  options: SessionCheckOptions = {},
): Promise<SessionCheck[]> {
  const now = options.now ?? Date.now();
  const env = options.env ?? process.env;
  const live = await readLive(env, now).catch(() => new Map());
  return Promise.all(
    sources.map(async (source) => {
      const check: SessionCheck = {
        source: source.name,
        where: source.where,
        newer: false,
        listed: 0,
        withPrompt: 0,
        withCwd: 0,
        withState: 0,
        sampled: 0,
        read: 0,
        withReply: 0,
        withTools: 0,
        problems: [],
        notes: [],
      };
      if (source.verified !== undefined) check.verified = source.verified;
      const version = await options.version?.(source).catch(() => undefined);
      if (version !== undefined) check.version = version;
      check.newer = version !== undefined && source.verified !== undefined && isNewer(version, source.verified);

      const query: SessionQuery = { env, since: options.since ?? now - 30 * DAY_MS, live: false };
      if (options.signal) query.signal = options.signal;
      let sessions: SessionInfo[];
      try {
        sessions = await source.list(query);
      } catch (error) {
        check.problems.push(`cannot list: ${error instanceof Error ? error.message : String(error)}`);
        return check;
      }
      check.listed = sessions.length;
      check.withPrompt = sessions.filter(hasPrompt).length;
      check.withCwd = sessions.filter((session) => session.cwd !== undefined).length;
      check.withState = sessions.filter((session) => session.state !== undefined).length;
      // Judged on the newest ones: a reader may fill in only those from the conversations.
      const newest = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, JUDGED);
      if (newest.length >= MIN_FOR_SHARES) {
        const prompts = newest.filter(hasPrompt).length;
        const dirs = newest.filter((session) => session.cwd !== undefined).length;
        const of = `of the ${newest.length} newest sessions`;
        if (prompts * 2 < newest.length) check.problems.push(`only ${prompts} ${of} have a prompt or a title`);
        if (source.where === 'local' && dirs * 2 < newest.length) {
          check.problems.push(`only ${dirs} ${of} have a directory`);
        }
      }

      if (source.read) {
        // Sessions with a prompt surely have a conversation to open; the others fill the sample,
        // so a store whose listing lost its prompts still has its conversations tried.
        const chosen = [...newest.filter(hasPrompt), ...newest.filter((session) => !hasPrompt(session))].slice(
          0,
          options.sample ?? 5,
        );
        check.sampled = chosen.length;
        let failed = false;
        for (const session of chosen) {
          const turns = await source.read(session, { maxTurns: 20 }).catch(() => {
            failed = true;
            return [];
          });
          if (!turns.length) continue;
          check.read += 1;
          const entries = turns.flatMap((turn) => turn.entries);
          if (entries.some((entry) => entry.kind === 'text')) check.withReply += 1;
          if (entries.some((entry) => entry.kind === 'tool')) check.withTools += 1;
        }
        if (check.sampled && !check.read) {
          const none = `none of the ${check.sampled} newest conversations could be read`;
          // Sessions with no prompt and nothing in them may just be empty, when nothing failed.
          if (failed || chosen.some(hasPrompt)) check.problems.push(none);
          else check.notes.push(`${none}: empty sessions, or a store that changed`);
        } else if (check.read && !check.withReply) {
          check.problems.push(`no agent message in the ${check.read} conversations read`);
        } else if (check.read >= 3 && !check.withTools) {
          check.notes.push(`no tool call in the ${check.read} conversations read`);
        }
      } else {
        check.notes.push('conversations cannot be read, only listed');
      }

      if ((HOOK_AGENTS as readonly string[]).includes(source.name)) {
        const hooks = await hooksStatus(source.name as HookAgent, { env }).catch(() => undefined);
        if (hooks) {
          const reported = [...live.values()].filter((record) => record.agent === source.name).length;
          check.hooks = { installed: hooks.installed, reported };
          // Sessions worked since the hooks went in, yet none of them said anything.
          const since = hooks.installed
            ? await stat(hooks.file).then(
                (file) => file.mtimeMs,
                () => undefined,
              )
            : undefined;
          const worked =
            since === undefined ? 0 : sessions.filter((session) => session.updatedAt > since + 60_000).length;
          if (!reported && worked) {
            check.notes.push(
              `hooks are installed but ${worked} session${worked === 1 ? '' : 's'} active since reported nothing` +
                (source.name === 'codex' ? ' (Codex runs hooks only once trusted under /hooks)' : ''),
            );
          }
        }
      }
      if (check.newer && check.problems.length) {
        check.notes.push(
          `the CLI (${check.version}) is newer than the one checked (${check.verified}): its store may have changed`,
        );
      }
      return check;
    }),
  );
}

function hasPrompt(session: SessionInfo): boolean {
  return (session.title ?? session.firstPrompt ?? session.lastPrompt) !== undefined;
}

/** Whether version `a` is later than `b`, comparing their numbers left to right. */
export function isNewer(a: string, b: string): boolean {
  const [left, right] = [a, b].map((version) => (version.match(/\d+/g) ?? []).map(Number));
  for (let at = 0; at < Math.max(left!.length, right!.length); at += 1) {
    const difference = (left![at] ?? 0) - (right![at] ?? 0);
    if (difference) return difference > 0;
  }
  return false;
}

/** The version `command --version` prints, or undefined when it prints none in a few seconds. */
export function cliVersion(command: string, env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(command, ['--version'], { env, timeout: 5000, windowsHide: true }, (error, stdout, stderr) => {
      resolve(error ? undefined : /\d+\.\d+(?:\.\d+)?/.exec(`${stdout}\n${stderr}`)?.[0]);
    });
  });
}
