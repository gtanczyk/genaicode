import type { SessionInfo } from '../agents/sessions/group.js';
import type { AgentFailure } from '../agents/types.js';

/** One entry of the agent chip's model list. */
export interface ModelSuggestion {
  model: string;
  /** Why it is listed: picked lately, how often and when the agent ran it, or a name the agent knows. */
  note: string;
}

export interface ModelSuggestionInput {
  agent: string;
  /** The agent's store (`SessionInfo.source`), when it has one. */
  store?: string;
  /** Sessions of the session index, of every agent: those of this one count. */
  sessions: readonly SessionInfo[];
  /** The model the open session's agent reported running (`SessionState.reportedModel`). */
  reported?: string;
  /** Names the driver knows its CLI takes (`capabilities.models`). */
  known?: readonly string[];
  /** Picked here lately, newest first (`readRecentModels`). */
  recent?: readonly string[];
  now?: number;
}

const DAY = 86_400_000;

function when(at: number, now: number): string {
  const days = Math.floor((now - at) / DAY);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(at).toISOString().slice(0, 10);
}

/**
 * What the agent chip's Model field suggests: the models picked here lately first, then those this
 * agent ran (sessions of the index, and what its open session reported), most used first, then the
 * names its driver knows. Each model once.
 */
export function modelSuggestions(input: ModelSuggestionInput): ModelSuggestion[] {
  const now = input.now ?? Date.now();
  const ran = new Map<string, { runs: number; last: number }>();
  for (const session of input.sessions) {
    const model = session.model?.trim();
    if (!model) continue;
    const mine = input.store ? session.source === input.store : session.agent === input.agent;
    if (!mine) continue;
    const seen = ran.get(model) ?? { runs: 0, last: 0 };
    ran.set(model, { runs: seen.runs + 1, last: Math.max(seen.last, session.updatedAt) });
  }
  const reported = input.reported?.trim();
  if (reported && !ran.has(reported)) ran.set(reported, { runs: 0, last: now });
  const ranNote = (model: string) => {
    const seen = ran.get(model);
    if (!seen) return undefined;
    if (!seen.runs) return 'running in this chat';
    return `ran in ${seen.runs} session${seen.runs === 1 ? '' : 's'}, last ${when(seen.last, now)}`;
  };
  const out: ModelSuggestion[] = [];
  const listed = new Set<string>();
  const add = (model: string, note: string) => {
    if (!model || listed.has(model)) return;
    listed.add(model);
    out.push({ model, note });
  };
  for (const model of input.recent ?? []) add(model, `picked lately${ranNote(model) ? ` · ${ranNote(model)}` : ''}`);
  const byUse = [...ran.entries()].sort((a, b) => b[1].runs - a[1].runs || b[1].last - a[1].last);
  for (const [model] of byUse) add(model, ranNote(model)!);
  for (const model of input.known ?? []) add(model, `a name ${input.agent} takes`);
  return out;
}

const RECENT_MAX = 5;

/** The `localStorage` key of the models picked for an agent. */
export function recentModelsKey(agent: string): string {
  return `genaicode.models.${agent}`;
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;

/** The models picked for the agent lately, newest first. */
export function readRecentModels(store: Store, agent: string): string[] {
  try {
    const kept: unknown = JSON.parse(store.getItem(recentModelsKey(agent)) ?? '[]');
    return Array.isArray(kept)
      ? kept.filter((item): item is string => typeof item === 'string').slice(0, RECENT_MAX)
      : [];
  } catch {
    return [];
  }
}

/** Remembers a model picked for the agent; an empty one (the agent's default) is not kept. */
export function rememberModel(store: Store, agent: string, model: string): string[] {
  const picked = model.trim();
  const before = readRecentModels(store, agent);
  if (!picked) return before;
  const next = [picked, ...before.filter((item) => item !== picked)].slice(0, RECENT_MAX);
  try {
    store.setItem(recentModelsKey(agent), JSON.stringify(next));
  } catch {
    // Storage full or blocked: the list lasts until the page is closed.
  }
  return next;
}

/** Drops a model from the agent's picks: one it did not accept. */
export function forgetModel(store: Store, agent: string, model: string): string[] {
  const next = readRecentModels(store, agent).filter((item) => item !== model.trim());
  try {
    store.setItem(recentModelsKey(agent), JSON.stringify(next));
  } catch {
    // Storage blocked: nothing kept to drop.
  }
  return next;
}

// How agent CLIs say a model name is not one they take: Claude Code ("There's an issue with the
// selected model (x). It may not exist or you may not have access to it."), Codex ("The 'x' model is
// not supported…", `model_not_found`), Gemini ("Requested entity was not found" for models/x), and
// API errors in general ("invalid model", "unknown model").
const REJECTED = [
  /issue with the selected model/i,
  /model_not_found|invalid_model|unknown_model/i,
  /\b(?:invalid|unknown|unsupported|unrecognized)\b[^.\n]{0,20}\bmodel\b/i,
  /\bmodel\b[^\n]{0,120}\b(?:not (?:found|supported|exist)|does not exist|doesn't exist|is not valid|no access|not have access|not allowed)\b/i,
];

// A model that is busy, not one the agent refuses: overloaded, out of capacity, limited for now.
const BUSY =
  /\b(?:overload(?:ed)?|capacity|high demand|temporarily|try again|rate.?limit(?:ed)?|quota|too many requests)\b/i;

/**
 * Whether a failed turn's error says the agent did not take the model it was given. Only with a
 * model set: an agent's own default failing is not this. Never for a sign-in or limit failure
 * (`failure`), whose own card says what to do, nor for a busy model.
 */
export function rejectsModel(
  error: string | undefined,
  model: string | undefined,
  failure?: AgentFailure['kind'],
): boolean {
  if (!error || !model?.trim()) return false;
  if (failure === 'auth' || failure === 'quota' || BUSY.test(error)) return false;
  if (REJECTED.some((pattern) => pattern.test(error))) return true;
  // Its name in an error that is about a model, as a CLI that names the model it was asked for says.
  return (
    /\bmodel\b/i.test(error) &&
    error.toLowerCase().includes(model.trim().toLowerCase()) &&
    /\b(?:not|invalid|unknown)\b/i.test(error)
  );
}
