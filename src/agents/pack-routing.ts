import type { AgentCapabilities } from './types.js';
import { limitsAgent, type KnownLimit } from './sessions/limits.js';

export interface RoutingCandidate {
  name: string;
  capabilities: AgentCapabilities;
  installed: boolean;
  /** Models this driver actually reported using during this pack's runs. */
  models?: ReadonlySet<string>;
}

export interface RoutingNeeds {
  model?: string;
  effort?: string;
  mcp?: boolean;
}

export interface QuotaHint {
  window: string;
  observedAt: number;
  resetsAt?: number;
  alternative?: string;
}

const FRESH_MS = 15 * 60_000;

/** A named pool or a model-specific window is not evidence about the whole account. */
function applies(limit: KnownLimit, model?: string): boolean {
  if (limit.name && limit.name.toLowerCase() !== limitsAgent(limit.agent).toLowerCase())
    return !!model && limit.name.toLowerCase() === model.toLowerCase();
  if (['quota', '5h', '7d', 'primary', 'secondary', 'spend'].includes(limit.window)) return true;
  if (/^\d+[mhdw]$/.test(limit.window)) return true;
  const family = /^7d-(opus|sonnet)$/.exec(limit.window)?.[1];
  return (
    !!family &&
    !!model &&
    model
      .toLowerCase()
      .split(/[-./:]/)
      .includes(family)
  );
}

/** The newest observation for each pool and window, including a recovery after a refusal. */
export function latestPackLimits(readings: readonly KnownLimit[], now: number): KnownLimit[] {
  const byWindow = new Map<string, KnownLimit>();
  for (const reading of readings) {
    if (!Number.isFinite(reading.at) || reading.at > now) continue;
    const key = JSON.stringify([limitsAgent(reading.agent), reading.name, reading.window]);
    if ((byWindow.get(key)?.at ?? -Infinity) <= reading.at) byWindow.set(key, reading);
  }
  return [...byWindow.values()].filter((r) => r.resetsAt === undefined || r.resetsAt > now);
}

/** Advisory only. Unknown quota or model support is never evidence for a replacement. */
export function quotaHints(
  candidates: readonly RoutingCandidate[],
  readings: readonly KnownLimit[],
  needs: RoutingNeeds = {},
  now = Date.now(),
): Map<string, QuotaHint> {
  const current = latestPackLimits(readings, now);
  const forAgent = (name: string) =>
    current.filter((r) => limitsAgent(r.agent) === limitsAgent(name) && applies(r, needs.model));
  const fresh = (r: KnownLimit) => now - r.at <= FRESH_MS;
  const exhausted = (r: KnownLimit) => r.status === 'exceeded' || (r.usedPercent ?? 0) >= 100;
  const suitable = candidates.filter((candidate) => {
    if (!candidate.installed || (needs.mcp && (!candidate.capabilities.mcp || candidate.capabilities.remote)))
      return false;
    if (needs.effort && !candidate.capabilities.effort?.includes(needs.effort)) return false;
    if (needs.model && !candidate.models?.has(needs.model)) return false;
    const readings = forAgent(candidate.name);
    return readings.some((r) => fresh(r) && r.usedPercent !== undefined && !exhausted(r)) && !readings.some(exhausted);
  });

  const hints = new Map<string, QuotaHint>();
  for (const candidate of candidates) {
    const blocked = forAgent(candidate.name).filter((r) => fresh(r) && exhausted(r));
    if (!blocked.length) continue;
    // If several windows are exhausted, the account must wait for all of them.
    const limiting = blocked.sort((a, b) => (b.resetsAt ?? Infinity) - (a.resetsAt ?? Infinity) || b.at - a.at)[0];
    const alternate = suitable.find((other) => limitsAgent(other.name) !== limitsAgent(candidate.name));
    hints.set(candidate.name, {
      window: limiting.name ? `${limiting.name} ${limiting.window}` : limiting.window,
      observedAt: limiting.at,
      ...(limiting.resetsAt !== undefined ? { resetsAt: limiting.resetsAt } : {}),
      ...(alternate ? { alternative: alternate.name } : {}),
    });
  }
  return hints;
}
