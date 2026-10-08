import type { AgentCapabilities, AgentPermissions, AgentTask, ApprovalPolicy, SandboxPolicy } from './types.js';

/** Full access, no questions. */
export const YOLO: Readonly<Required<AgentPermissions>> = Object.freeze({
  approval: 'auto-approve',
  sandbox: 'unrestricted',
});

const APPROVALS: readonly ApprovalPolicy[] = ['ask', 'auto-approve', 'deny'];
const SANDBOXES: readonly SandboxPolicy[] = ['workspace-write', 'read-only', 'unrestricted'];

/** `task.permissions` as an object: `'yolo'` expanded, nothing set for an omitted value. */
export function resolvePermissions(permissions: AgentTask['permissions']): AgentPermissions {
  if (permissions === undefined) return {};
  if (permissions === 'yolo') return { ...YOLO };
  if (typeof permissions !== 'object' || permissions === null || Array.isArray(permissions))
    throw new Error(`Invalid task.permissions: ${JSON.stringify(permissions)}.`);
  // A misspelled field must not quietly fall back to the driver's defaults.
  const unknown = Object.keys(permissions).filter((key) => key !== 'approval' && key !== 'sandbox');
  if (unknown.length) throw new Error(`Unknown task.permissions field: ${unknown.join(', ')}.`);
  const { approval, sandbox } = permissions;
  if (approval !== undefined && !APPROVALS.includes(approval))
    throw new Error(`Unknown permissions.approval: ${JSON.stringify(approval)}.`);
  if (sandbox !== undefined && !SANDBOXES.includes(sandbox))
    throw new Error(`Unknown permissions.sandbox: ${JSON.stringify(sandbox)}.`);
  return {
    ...(approval !== undefined ? { approval } : {}),
    ...(sandbox !== undefined ? { sandbox } : {}),
  };
}

/** Why `task.permissions` cannot run on this agent, or undefined when it can. */
export function unsupportedPermissions(
  name: string,
  capabilities: AgentCapabilities,
  task: Pick<AgentTask, 'permissions' | 'onApproval'>,
): string | undefined {
  let permissions: AgentPermissions;
  try {
    permissions = resolvePermissions(task.permissions);
  } catch (error) {
    return (error as Error).message;
  }
  const supported = capabilities.permissions ?? {};
  const check = (field: 'approval' | 'sandbox', value: string | undefined, values: readonly string[] = []) =>
    value === undefined || values.includes(value)
      ? undefined
      : `${name} cannot run with permissions.${field} '${value}' (supported: ${values.join(', ') || 'none'}).`;
  const refused =
    check('approval', permissions.approval, supported.approval) ??
    check('sandbox', permissions.sandbox, supported.sandbox);
  if (refused) return refused;
  if (permissions.approval === 'ask' && !task.onApproval) return "permissions.approval 'ask' needs task.onApproval.";
  return undefined;
}

/**
 * One agent's command-line translation of `AgentPermissions` (see `applyPermissionArgs`).
 * Throws when the agent cannot honor the combination.
 */
export interface PermissionFlags {
  /** Arguments to add. */
  args: string[];
  /** Flags these arguments replace; any already present are removed first, with their values. */
  replaces: Readonly<Record<string, 'flag' | 'value'>>;
  /** Environment variables to set. */
  env?: Record<string, string>;
}

/**
 * Remove the flags `replaces` names from `args` (both `--flag value` and `--flag=value`), then
 * insert `flags.args` after a leading subcommand word (`exec`, `run`...), so a trailing
 * `-p` / `--prompt` keeps its value and `exec resume <id> <prompt>` keeps its positionals.
 */
export function mergePermissionFlags(args: readonly string[], flags: PermissionFlags): string[] {
  const kept: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--') {
      kept.push(...args.slice(i));
      break;
    }
    const name = arg.includes('=') ? arg.slice(0, arg.indexOf('=')) : arg;
    const kind = flags.replaces[name];
    if (!kind) kept.push(arg);
    else if (kind === 'value' && name === arg) i++;
  }
  const at = kept.length && !kept[0]!.startsWith('-') ? 1 : 0;
  return [...kept.slice(0, at), ...flags.args, ...kept.slice(at)];
}

/** Throw unless the agent option the permissions would set was left at its default. */
export function exclusiveOption(name: string, option: string, set: boolean, field: string, wanted: boolean): void {
  if (set && wanted)
    throw new Error(`${name}: set either the ${option} option or task.permissions.${field}, not both.`);
}
