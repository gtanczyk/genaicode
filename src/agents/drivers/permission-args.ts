import { mergePermissionFlags, resolvePermissions, type PermissionFlags } from '../permissions.js';
import type { AgentPermissions, AgentTask } from '../types.js';
import { antigravityPermissionFlags } from './antigravity.js';
import { claudePermissionFlags } from './claude-approvals.js';
import { codexPermissionFlags } from './codex.js';
import { copilotPermissionFlags } from './copilot.js';
import { cursorPermissionFlags } from './cursor.js';
import { geminiPermissionFlags } from './gemini.js';
import { opencodePermissionFlags } from './opencode.js';
import { vibePermissionFlags } from './vibe.js';

const FLAGS: Record<string, (permissions: AgentPermissions) => PermissionFlags> = {
  claude: claudePermissionFlags,
  codex: codexPermissionFlags,
  gemini: geminiPermissionFlags,
  cursor: cursorPermissionFlags,
  copilot: copilotPermissionFlags,
  opencode: opencodePermissionFlags,
  vibe: vibePermissionFlags,
  antigravity: antigravityPermissionFlags,
  agy: antigravityPermissionFlags,
};

/** Agents `applyPermissionArgs` can translate for (`agy` is Antigravity). */
export const PERMISSION_AGENTS: readonly string[] = Object.keys(FLAGS);

/**
 * Rewrite an agent's own headless argument list (one an app keeps outside the genaicode
 * drivers) for `permissions`: flags the translation owns are replaced, the rest kept. Each
 * agent's translation is the one its driver uses (`claudePermissionFlags`, ...). Throws for an
 * unknown agent or a combination it cannot honor. For Claude, `ask` and `auto-approve` also
 * need the permission prompt tool (`claudeApprovalTool` with the same sandbox).
 */
export function applyPermissionArgs(
  agent: string,
  args: readonly string[],
  permissions: AgentTask['permissions'],
): { args: string[]; env: Record<string, string> } {
  const translate = FLAGS[agent];
  if (!translate) throw new Error(`No permission translation for agent ${JSON.stringify(agent)}.`);
  const resolved = resolvePermissions(permissions);
  if (resolved.approval === undefined && resolved.sandbox === undefined) return { args: [...args], env: {} };
  const flags = translate(resolved);
  return { args: mergePermissionFlags(args, flags), env: { ...flags.env } };
}
