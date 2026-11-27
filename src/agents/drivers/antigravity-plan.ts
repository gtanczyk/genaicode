import type { ProgressStep } from '../progress.js';
import type { AgentEvent } from '../types.js';
import { isObject, stringField } from './json.js';

/** Parse ACP `plan` entries or Antigravity `update_steps` items into a progress event. */
export function antigravityPlanProgress(items: unknown): Extract<AgentEvent, { type: 'progress' }> | undefined {
  if (!Array.isArray(items)) return undefined;
  if (items.length === 0) return { type: 'progress', message: 'Plan cleared', plan: [] };
  const all: ProgressStep[] = [];
  for (const item of items) {
    if (!isObject(item)) continue;
    const step = (stringField(item, 'title') ?? stringField(item, 'content') ?? stringField(item, 'step'))?.trim();
    if (!step) continue;
    const raw = (stringField(item, 'status') ?? '').toLowerCase();
    const status: ProgressStep['status'] =
      raw === 'done' || raw === 'completed' ? 'completed' : raw === 'in_progress' ? 'in_progress' : 'pending';
    all.push({ step: step.slice(0, 200), status });
  }
  if (!all.length) return undefined;
  // Compute status from the full snapshot before capping the displayed checklist to 12 items.
  const active = all.find((item) => item.status === 'in_progress');
  const message =
    active?.step ??
    (all.every((item) => item.status === 'completed') ? 'Completed all steps' : (all[0]?.step ?? 'Updated plan'));
  return { type: 'progress', message, plan: all.slice(0, 12) };
}
