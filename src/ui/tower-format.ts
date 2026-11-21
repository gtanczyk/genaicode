import type { TowerDecision, TowerItem } from '../agents/sessions/tower.js';

/** Render terminal and direction controls visibly in both operator views. */
export function towerText(value: string, multiline = false): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, (c) =>
    multiline && (c === '\n' || c === '\t') ? c : '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'),
  );
}

export function towerAction(item: TowerItem): string {
  if (item.kind === 'proposal') return 'Proposed message';
  if (item.kind === 'sending') return 'Sending message';
  if (item.kind === 'native') return 'Answer in ' + towerText(item.agent);
  return item.scope === 'turn' ? 'Permission for this turn' : 'Permission request';
}

/** The buttons and their terminal shortcuts must grant the same decision and scope. */
export function towerChoices(item: TowerItem): { key: string; decision: TowerDecision; label: string }[] {
  if (item.kind === 'proposal')
    return [
      { key: 's', decision: 'send', label: 'Send to session' },
      { key: 'd', decision: 'dismiss', label: 'Dismiss' },
    ];
  if (item.kind === 'approval')
    return [
      { key: 'y', decision: 'approve', label: item.scope === 'turn' ? 'Approve for this turn' : 'Approve once' },
      { key: 'n', decision: 'deny', label: 'Deny' },
    ];
  return [];
}
