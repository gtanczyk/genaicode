import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { epochMs, limitStatus, windowLabel } from '../runtime.js';
import type { RateLimit } from '../types.js';
import { findFiles, homeOf, isRecord } from './files.js';

/** A plan limit as last seen: the reading and when it was taken. */
export interface KnownLimit extends RateLimit {
  /** Whose limit: `claude`, `codex`... */
  agent: string;
  /** When this was read, in epoch milliseconds. */
  at: number;
}

/** A reading with no reset time says nothing after this long. */
const KEEP_MS = 24 * 3600_000;
/** How many of Codex's newest sessions are looked at for its limits. */
const ROLLOUTS = 5;
const TAIL = 256 * 1024;

/** Where the readings are kept: one small file per agent under `~/.genaicode/limits`. */
export function limitsDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(env.GENAICODE_HOME ?? path.join(homeOf(env), '.genaicode'), 'limits');
}

/** The account a driver draws on: `codexLive` and `codex` share one. */
export function limitsAgent(driver: string): string {
  return driver.replace(/Live$/, '');
}

/**
 * What a run does with a limit its agent reports: kept under the home of the environment the agent
 * ran in. Off in the caller's own environment counts too, whatever the agent was given.
 */
export function keepRunLimit(driver: string, limit: RateLimit, env: NodeJS.ProcessEnv | undefined): void {
  if (process.env.GENAICODE_LIMITS === 'off') return;
  recordLimits(limitsAgent(driver), [limit], env ?? process.env);
}

const keyOf = (limit: RateLimit): string => (limit.name ? `${limit.window}:${limit.name}` : limit.window);

function fileOf(dir: string, agent: string): string | undefined {
  return /^[A-Za-z0-9_-]{1,40}$/.test(agent) ? path.join(dir, `${agent}.json`) : undefined;
}

function limitOf(value: unknown, agent: string): KnownLimit | undefined {
  if (!isRecord(value) || typeof value.window !== 'string' || typeof value.at !== 'number') return undefined;
  const status = value.status === 'warning' || value.status === 'exceeded' ? value.status : 'ok';
  return {
    agent,
    window: value.window,
    status,
    ...(typeof value.usedPercent === 'number' ? { usedPercent: value.usedPercent } : {}),
    ...(typeof value.resetsAt === 'number' ? { resetsAt: value.resetsAt } : {}),
    ...(typeof value.name === 'string' ? { name: value.name } : {}),
    at: value.at,
  };
}

function parseStored(text: string, agent: string): KnownLimit[] {
  try {
    const stored: unknown = JSON.parse(text);
    if (!isRecord(stored) || !isRecord(stored.windows)) return [];
    return Object.values(stored.windows)
      .map((value) => limitOf(value, agent))
      .filter((limit): limit is KnownLimit => limit !== undefined);
  } catch {
    return [];
  }
}

/** A window that reset since it was read, or a reading too old to mean anything, is not known. */
const current = (limit: KnownLimit, now: number): boolean =>
  limit.resetsAt !== undefined ? limit.resetsAt > now : now - limit.at < KEEP_MS;

/**
 * Keep what an agent said about its limits, so it is known between runs. Never throws: a run
 * must not fail for a note that could not be written. `GENAICODE_LIMITS=off` keeps nothing.
 */
export function recordLimits(
  agent: string,
  limits: readonly RateLimit[],
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): void {
  if (!limits.length || env.GENAICODE_LIMITS === 'off') return;
  try {
    const dir = limitsDir(env);
    const file = fileOf(dir, agent);
    if (!file) return;
    let known: KnownLimit[] = [];
    try {
      known = parseStored(readFileSync(file, 'utf8'), agent);
    } catch {
      // Nothing kept yet.
    }
    const windows = new Map(known.filter((limit) => current(limit, now)).map((limit) => [keyOf(limit), limit]));
    for (const limit of limits) windows.set(keyOf(limit), { ...limit, agent, at: now });
    const stored = Object.fromEntries(
      [...windows].map(([key, limit]) => {
        const kept: Partial<KnownLimit> = { ...limit };
        delete kept.agent;
        return [key, kept];
      }),
    );
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const temporary = `${file}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify({ agent, windows: stored })}\n`, { mode: 0o600 });
    renameSync(temporary, file);
  } catch {
    // Not kept.
  }
}

/**
 * The `rate_limits` of Claude Code's status line input (`five_hour`, `seven_day`, with
 * `used_percentage` and `resets_at` in seconds) as limits.
 */
export function statusLineLimits(input: unknown): RateLimit[] {
  const limits = isRecord(input) && isRecord(input.rate_limits) ? input.rate_limits : undefined;
  if (!limits) return [];
  const found: RateLimit[] = [];
  for (const [key, window] of [
    ['five_hour', '5h'],
    ['seven_day', '7d'],
    ['spend_limit', 'spend'],
  ] as const) {
    const value = limits[key];
    if (!isRecord(value) || typeof value.used_percentage !== 'number') continue;
    const resetsAt = epochMs(typeof value.resets_at === 'number' ? value.resets_at : undefined);
    found.push({
      window,
      status: limitStatus(value.used_percentage),
      usedPercent: Math.round(value.used_percentage * 10) / 10,
      ...(resetsAt !== undefined ? { resetsAt } : {}),
    });
  }
  return found;
}

/** The `rate_limits` of a `token_count` line in a Codex rollout (`primary`, `secondary`). */
export function rolloutLimits(limits: unknown, at: number): RateLimit[] {
  if (!isRecord(limits)) return [];
  const found: RateLimit[] = [];
  for (const key of ['primary', 'secondary'] as const) {
    const value = limits[key];
    if (!isRecord(value) || typeof value.used_percent !== 'number') continue;
    const minutes = typeof value.window_minutes === 'number' ? value.window_minutes : undefined;
    const resetsAt =
      epochMs(typeof value.resets_at === 'number' ? value.resets_at : undefined) ??
      (typeof value.resets_in_seconds === 'number' ? at + value.resets_in_seconds * 1000 : undefined);
    found.push({
      window: minutes ? windowLabel(minutes) : key,
      status: limitStatus(value.used_percent),
      usedPercent: Math.round(value.used_percent * 10) / 10,
      ...(resetsAt !== undefined ? { resetsAt } : {}),
    });
  }
  return found;
}

/**
 * The last limits Codex wrote into each of its newest sessions: it notes them with every token
 * count. The session written to last need not hold the newest reading, so each one's is given.
 */
async function codexLimits(env: NodeJS.ProcessEnv): Promise<KnownLimit[]> {
  const dir = path.join(env.CODEX_HOME ?? path.join(homeOf(env), '.codex'), 'sessions');
  const rollouts = await findFiles(dir, 3, (name) => name.startsWith('rollout-') && name.endsWith('.jsonl'));
  const found: KnownLimit[] = [];
  for (const rollout of rollouts.slice(0, ROLLOUTS)) {
    let text: string;
    try {
      const handle = await fs.open(rollout.path, 'r');
      try {
        const size = Math.min(rollout.size, TAIL);
        const buffer = Buffer.alloc(size);
        await handle.read(buffer, 0, size, rollout.size - size);
        text = buffer.toString('utf8');
      } finally {
        await handle.close();
      }
    } catch {
      continue;
    }
    const lines = text.split('\n');
    for (let index = lines.length - 1; index >= 0; index--) {
      const raw = lines[index]!;
      if (!raw.includes('"rate_limits"')) continue;
      let line: unknown;
      try {
        line = JSON.parse(raw);
      } catch {
        continue;
      }
      if (!isRecord(line) || !isRecord(line.payload) || line.payload.type !== 'token_count') continue;
      const stamp = typeof line.timestamp === 'string' ? Date.parse(line.timestamp) : NaN;
      const at = Number.isNaN(stamp) ? rollout.mtimeMs : stamp;
      const limits = rolloutLimits(line.payload.rate_limits, at);
      if (!limits.length) continue;
      found.push(...limits.map((limit) => ({ ...limit, agent: 'codex', at })));
      break;
    }
  }
  return found;
}

/**
 * The limits of every agent as last seen, without asking any of them: what runs through genaicode
 * and Claude Code's status line left in `~/.genaicode/limits`, and what Codex keeps in its own
 * sessions. The newest reading of a window wins; windows that reset since are left out.
 */
export async function knownLimits(env: NodeJS.ProcessEnv = process.env, now = Date.now()): Promise<KnownLimit[]> {
  const dir = limitsDir(env);
  const all: KnownLimit[] = [];
  let names: string[] = [];
  try {
    names = await fs.readdir(dir);
  } catch {
    // Nothing kept yet.
  }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const agent = name.slice(0, -'.json'.length);
    if (!fileOf(dir, agent)) continue;
    try {
      all.push(...parseStored(await fs.readFile(path.join(dir, name), 'utf8'), agent));
    } catch {
      // Removed while listing.
    }
  }
  all.push(...(await codexLimits(env)));
  const newest = new Map<string, KnownLimit>();
  for (const limit of all) {
    if (!current(limit, now)) continue;
    const key = `${limit.agent}/${keyOf(limit)}`;
    const other = newest.get(key);
    if (!other || other.at < limit.at) newest.set(key, limit);
  }
  return [...newest.values()].sort(
    (a, b) => a.agent.localeCompare(b.agent) || windowOrder(a) - windowOrder(b) || keyOf(a).localeCompare(keyOf(b)),
  );
}

/** Shorter windows first; the ones with no length last. */
function windowOrder(limit: RateLimit): number {
  const match = /^(\d+)([mhd])/.exec(limit.window);
  if (!match) return Number.MAX_SAFE_INTEGER;
  return Number(match[1]) * (match[2] === 'd' ? 1440 : match[2] === 'h' ? 60 : 1);
}

function span(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
  return `${Math.round(hours / 24)} d`;
}

/** `5h 62%`: a limit as short as a menu bar wants it. */
export function shortLimit(limit: RateLimit): string {
  const name = limit.name ? `${limit.name} ${limit.window}` : limit.window;
  if (limit.usedPercent !== undefined) return `${name} ${Math.round(limit.usedPercent)}%`;
  return `${name} ${limit.status === 'exceeded' ? 'used up' : limit.status}`;
}

/** The known limits as lines for a terminal: used share, when it resets, how old the reading is. */
export function describeKnownLimits(limits: readonly KnownLimit[], now = Date.now()): string[] {
  const width = Math.max(0, ...limits.map((limit) => limit.agent.length));
  let last: string | undefined;
  return limits.map((limit) => {
    const agent = (limit.agent === last ? '' : limit.agent).padEnd(width);
    last = limit.agent;
    const used =
      limit.usedPercent !== undefined
        ? `${Math.round(limit.usedPercent)}% used`
        : limit.status === 'exceeded'
          ? 'used up'
          : limit.status;
    const parts = [
      `${limit.name ? `${limit.name} ${limit.window}` : limit.window}`.padEnd(6),
      limit.status === 'exceeded' && limit.usedPercent !== undefined ? `${used}, refused` : used,
    ];
    if (limit.resetsAt !== undefined) parts.push(`resets in ${span(limit.resetsAt - now)}`);
    return `${agent}  ${parts.join('  ')}  (read ${now - limit.at < 60_000 ? 'just now' : `${span(now - limit.at)} ago`})`;
  });
}
