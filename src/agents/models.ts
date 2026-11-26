import { execFile } from 'node:child_process';
import { stripVTControlCharacters } from 'node:util';
import { findAllExecutables } from './discovery.js';
import type { CodingAgent } from './types.js';

/** A model an agent CLI reported as available for this account. */
export interface DiscoveredModel {
  id: string;
  label?: string;
}

export interface ListModelsOptions {
  /** Timeout for the CLI's `models` subcommand in ms. Default 10,000. */
  timeoutMs?: number;
  /** Working directory for project-scoped model listings (e.g. `opencode models`). */
  cwd?: string;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@[\]=,-]*$/;

function cleanLines(output: string): string[] {
  const out: string[] = [];
  // Normalize CRLF first so Windows line endings do not leave a trailing `\r` after each line.
  for (const raw of stripVTControlCharacters(output).replace(/\r\n/g, '\n').split('\n')) {
    // Spinner updates use standalone `\r` to overwrite the same line; take the last non-empty segment.
    const parts = raw.split('\r');
    let last = '';
    for (let i = parts.length - 1; i >= 0; i -= 1) {
      const candidate = parts[i]!.trim();
      if (candidate) {
        last = candidate;
        break;
      }
    }
    if (last) out.push(last);
  }
  return out;
}

function dedupe(items: DiscoveredModel[]): DiscoveredModel[] {
  const seen = new Set<string>();
  const out: DiscoveredModel[] = [];
  for (const item of items) {
    if (!item.id || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

/**
 * Parse `agy models` output: `<id>   <Human Name>` (after spinner lines).
 */
export function parseAgyModels(output: string): DiscoveredModel[] {
  const items: DiscoveredModel[] = [];
  for (const line of cleanLines(output)) {
    if (/^(?:fetching|available|loading|error|warning|usage)\b/i.test(line)) continue;
    const match = /^(\S+)(?:\s{2,}(.+))?$/.exec(line);
    if (!match) continue;
    const id = match[1]!;
    const label = match[2]?.trim();
    if (!MODEL_ID_RE.test(id)) continue;
    items.push(label && label !== id ? { id, label } : { id });
  }
  return dedupe(items);
}

/**
 * Parse `cursor-agent models` output: `<id> - <Label>` or `<id>  <Label>`.
 */
export function parseCursorModels(output: string): DiscoveredModel[] {
  const items: DiscoveredModel[] = [];
  for (const line of cleanLines(output)) {
    if (/^(?:available models|tip:|error:|loading|fetching|usage:)/i.test(line)) continue;
    const dash = /^(\S+)\s+-\s+(.+)$/.exec(line);
    if (dash && MODEL_ID_RE.test(dash[1]!)) {
      const label = dash[2]!.trim();
      items.push(label && label !== dash[1] ? { id: dash[1]!, label } : { id: dash[1]! });
      continue;
    }
    const cols = /^(\S+)\s{2,}(.+)$/.exec(line);
    if (cols && MODEL_ID_RE.test(cols[1]!)) {
      const label = cols[2]!.trim();
      items.push(label && label !== cols[1] ? { id: cols[1]!, label } : { id: cols[1]! });
    }
  }
  return dedupe(items);
}

/**
 * Parse `opencode models` output: one `provider/model` identifier per line.
 */
export function parseOpencodeModels(output: string): DiscoveredModel[] {
  const items: DiscoveredModel[] = [];
  for (const line of cleanLines(output)) {
    if (/\s/.test(line) || !line.includes('/') || !MODEL_ID_RE.test(line)) continue;
    items.push({ id: line });
  }
  return dedupe(items);
}

const MODEL_PROBES: Readonly<Record<string, { args: readonly string[]; parse(output: string): DiscoveredModel[] }>> = {
  antigravity: { args: ['models'], parse: parseAgyModels },
  cursor: { args: ['models'], parse: parseCursorModels },
  opencode: { args: ['models'], parse: parseOpencodeModels },
};

/** Whether genaicode knows a cheap `models` subcommand for this agent. */
export function canDiscoverModels(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(MODEL_PROBES, name);
}

/**
 * Ask an installed agent CLI which models it offers (e.g. `agy models`, `cursor-agent models`).
 * Returns `[]` when the agent has no listing subcommand, is not installed, is signed out, or times out.
 */
export async function listAgentModels(
  agent: Pick<CodingAgent, 'name' | 'command'>,
  env: NodeJS.ProcessEnv = process.env,
  options: ListModelsOptions = {},
): Promise<DiscoveredModel[]> {
  const probe = MODEL_PROBES[agent.name];
  if (!probe) return [];
  const executable = findAllExecutables(agent.command, env)[0];
  if (!executable) return [];
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return new Promise((resolve) => {
    execFile(
      executable,
      probe.args,
      {
        env,
        timeout: timeoutMs,
        maxBuffer: 512 * 1024,
        windowsHide: true,
        ...(options.cwd ? { cwd: options.cwd } : {}),
      },
      (error, stdout) => {
        if (error) return resolve([]);
        const text = typeof stdout === 'string' ? stdout : String(stdout ?? '');
        resolve(probe.parse(text));
      },
    );
  });
}

export interface ModelCatalogOptions {
  agents: readonly Pick<CodingAgent, 'name' | 'command'>[];
  getEnv: () => NodeJS.ProcessEnv;
  /** Cache lifetime for non-empty results in ms. Default 5 minutes. */
  ttlMs?: number;
  /** Cache lifetime for empty/failed probes in ms. Default 30 seconds. */
  emptyTtlMs?: number;
  timeoutMs?: number;
}

export interface ModelCatalog {
  list(agentName: string, options?: { refresh?: boolean; cwd?: string }): Promise<DiscoveredModel[]>;
  invalidate(agentName?: string): void;
}

/**
 * Per-agent (and per-directory) cached, deduplicated model discovery for `GET /api/models?agent=<name>`.
 * Runs only on demand when requested (never during startup or `/api/agents` polls).
 */
export function createModelCatalog(options: ModelCatalogOptions): ModelCatalog {
  const ttlMs = options.ttlMs ?? 5 * 60_000;
  const emptyTtlMs = options.emptyTtlMs ?? 30_000;
  const byName = new Map(options.agents.map((agent) => [agent.name, agent]));
  const cache = new Map<string, { at: number; models: DiscoveredModel[] }>();
  const inFlight = new Map<string, { epoch: number; promise: Promise<DiscoveredModel[]> }>();
  let epoch = 0;

  return {
    async list(agentName, req = {}) {
      const agent = byName.get(agentName);
      if (!agent || !canDiscoverModels(agent.name)) return [];
      const cwd = req.cwd?.trim() || undefined;
      const key = `${agentName}\0${cwd ?? ''}`;
      const cached = cache.get(key);
      const ttl = cached?.models.length ? ttlMs : emptyTtlMs;
      if (!req.refresh && cached && Date.now() - cached.at < ttl) return cached.models;
      const existing = inFlight.get(key);
      // Only reuse an in-flight probe from the current generation (never one predating `invalidate()`).
      if (!req.refresh && existing && existing.epoch === epoch) return existing.promise;
      const startEpoch = epoch;
      const entry = {
        epoch: startEpoch,
        promise: listAgentModels(agent, options.getEnv(), {
          ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
          ...(cwd ? { cwd } : {}),
        })
          .then((models) => {
            if (startEpoch === epoch) cache.set(key, { at: Date.now(), models });
            return models;
          })
          .finally(() => {
            if (inFlight.get(key) === entry) inFlight.delete(key);
          }),
      };
      inFlight.set(key, entry);
      return entry.promise;
    },
    invalidate(agentName) {
      epoch += 1;
      if (!agentName) {
        cache.clear();
        return;
      }
      const prefix = `${agentName}\0`;
      for (const key of [...cache.keys()]) {
        if (key.startsWith(prefix)) cache.delete(key);
      }
    },
  };
}
