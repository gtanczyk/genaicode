import { describe, expect, it } from 'vitest';
import type { SessionInfo } from '../agents/sessions/group.js';
import { forgetModel, modelSuggestions, readRecentModels, rejectsModel, rememberModel } from './models.js';

const now = Date.parse('2026-11-25T12:00:00Z');
const day = 86_400_000;
const session = (id: string, model: string | undefined, updatedAt: number, source = 'claude'): SessionInfo => ({
  source,
  agent: source,
  id,
  where: 'local',
  updatedAt,
  ...(model ? { model } : {}),
});

function memoryStore() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
}

describe('modelSuggestions', () => {
  it('lists picks first, then what the agent ran by use, then the names it knows, each once', () => {
    const sessions = [
      session('a', 'claude-sonnet-5-5', now - 3 * day),
      session('b', 'claude-opus-5-5', now - day),
      session('c', 'claude-opus-5-5', now - 2 * day),
      session('d', undefined, now),
      // Another agent's model is not this one's.
      session('e', 'gpt-x', now, 'codex'),
    ];
    const list = modelSuggestions({
      agent: 'claude',
      store: 'claude',
      sessions,
      reported: 'claude-haiku-5-5',
      known: ['opus', 'sonnet', 'claude-opus-5-5'],
      recent: ['sonnet'],
      now,
    });
    expect(list).toEqual([
      { model: 'sonnet', note: 'picked lately' },
      { model: 'claude-opus-5-5', note: 'ran in 2 sessions, last yesterday' },
      { model: 'claude-sonnet-5-5', note: 'ran in 1 session, last 3 days ago' },
      { model: 'claude-haiku-5-5', note: 'running in this chat' },
      { model: 'opus', note: 'a name claude takes' },
    ]);
  });

  it('matches sessions by agent name when the agent has no store', () => {
    const list = modelSuggestions({ agent: 'codex', sessions: [session('e', 'gpt-x', now, 'codex')], now });
    expect(list.map((item) => item.model)).toEqual(['gpt-x']);
  });

  it('includes discovered CLI models and attaches their human-readable labels to recent/ran models', () => {
    const list = modelSuggestions({
      agent: 'antigravity',
      sessions: [],
      recent: ['gemini-4-neon-high'],
      discovered: [
        { id: 'gemini-4-neon-high', label: 'Gemini 4 Neon (High)' },
        { id: 'claude-opus-5-5-high', label: 'Claude Opus 5.5 (High)' },
        { id: 'custom-raw' },
      ],
      now,
    });
    expect(list).toEqual([
      { model: 'gemini-4-neon-high', label: 'Gemini 4 Neon (High)', note: 'picked lately' },
      { model: 'claude-opus-5-5-high', label: 'Claude Opus 5.5 (High)', note: 'Claude Opus 5.5 (High)' },
      { model: 'custom-raw', note: 'available in antigravity' },
    ]);
  });
});

describe('recent models', () => {
  it('keeps the latest picks per agent, newest first, without the default', () => {
    const store = memoryStore();
    rememberModel(store, 'claude', 'opus');
    rememberModel(store, 'claude', 'sonnet');
    rememberModel(store, 'claude', 'opus');
    rememberModel(store, 'claude', '  ');
    expect(readRecentModels(store, 'claude')).toEqual(['opus', 'sonnet']);
    expect(readRecentModels(store, 'codex')).toEqual([]);
    for (const model of ['a', 'b', 'c', 'd', 'e']) rememberModel(store, 'claude', model);
    expect(readRecentModels(store, 'claude')).toEqual(['e', 'd', 'c', 'b', 'a']);
    expect(forgetModel(store, 'claude', 'c')).toEqual(['e', 'd', 'b', 'a']);
    expect(readRecentModels(store, 'claude')).toEqual(['e', 'd', 'b', 'a']);
  });

  it('reads a broken entry as none', () => {
    const store = memoryStore();
    store.setItem('genaicode.models.claude', '{oops');
    expect(readRecentModels(store, 'claude')).toEqual([]);
  });
});

describe('rejectsModel', () => {
  it('knows how agents say a model is not one they take', () => {
    expect(
      rejectsModel(
        "There's an issue with the selected model (claude-opus-9). It may not exist or you may not have access to it.",
        'claude-opus-9',
      ),
    ).toBe(true);
    expect(rejectsModel("The 'gpt-9' model is not supported when using Codex with a ChatGPT account.", 'gpt-9')).toBe(
      true,
    );
    expect(rejectsModel('error: {"code":"model_not_found"}', 'x')).toBe(true);
    expect(rejectsModel('Invalid model name: flsh', 'flsh')).toBe(true);
  });

  it('says nothing without a model set, or for other failures', () => {
    expect(rejectsModel("There's an issue with the selected model (x).", undefined)).toBe(false);
    expect(rejectsModel('Rate limit reached. Try again later.', 'opus')).toBe(false);
    expect(rejectsModel('The tests failed: 3 of 10.', 'opus')).toBe(false);
  });

  it('leaves a busy model and sign-in or limit failures to their own message', () => {
    expect(rejectsModel('You have hit your quota for claude-opus-9. It resets at 5pm.', 'claude-opus-9')).toBe(false);
    expect(rejectsModel('Model claude-opus-9 is not found here', 'claude-opus-9', 'quota')).toBe(false);
    expect(rejectsModel("There's an issue with the selected model (opus).", 'opus', 'auth')).toBe(false);
    expect(rejectsModel('The model gpt-9 is not available right now due to high demand.', 'gpt-9')).toBe(false);
    expect(rejectsModel('Model gpt-9 is overloaded, not ready.', 'gpt-9')).toBe(false);
    // "not" inside a word does not count.
    expect(rejectsModel('gpt-9 model: nothing to report, connection reset', 'gpt-9')).toBe(false);
  });
});
