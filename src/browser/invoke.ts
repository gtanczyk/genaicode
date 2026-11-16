import { resolvePermissions } from '../agents/permissions.js';
import type { AgentEvent, AgentTask, ApprovalRequest } from '../agents/types.js';
import { abortable } from './language-model.js';
import { argumentProblems, toolText, type PageTool } from './tools.js';

/** Check the arguments, ask the user about a `write` tool, then run it. */
export async function invoke(
  tool: PageTool,
  args: Record<string, unknown>,
  id: string,
  task: AgentTask,
  emit: (event: AgentEvent) => void,
  signal: AbortSignal,
): Promise<string> {
  const problems = argumentProblems(tool, args);
  if (problems.length) throw new Error(`Bad arguments: ${problems.join('; ')}.`);
  tool.validate?.(args);
  if (tool.write) {
    const request: ApprovalRequest = {
      id,
      kind: 'other',
      summary: tool.summary?.(args) ?? `${tool.name} ${stableJson(args)}`,
      detail: { tool: tool.name, args },
      scope: 'once',
    };
    const decision = await ask(request, task, emit, signal);
    if (decision === 'read-only') throw new Error('Not allowed: this task is read-only.');
    if (decision === 'not-allowed') throw new Error('Not allowed: this needs the user’s approval.');
    if (decision !== 'approve') throw new Error('The user declined this action.');
  }
  return toolText(await abortable(Promise.resolve(tool.run(args, signal)), signal));
}

/**
 * Ask the user about `request` as `task.permissions` says: `read-only` and `not-allowed` without
 * asking (a read-only task, or approvals set to `deny`), otherwise the user's answer, reported as
 * `approval-request` and `approval-resolved` events.
 */
export async function ask(
  request: ApprovalRequest,
  task: AgentTask,
  emit: (event: AgentEvent) => void,
  signal: AbortSignal,
): Promise<'approve' | 'deny' | 'read-only' | 'not-allowed'> {
  const permissions = resolvePermissions(task.permissions);
  if (permissions.sandbox === 'read-only') return 'read-only';
  const approval = permissions.approval ?? 'ask';
  if (approval === 'deny') return 'not-allowed';
  emit({ type: 'approval-request', request });
  let decision: 'approve' | 'deny' = 'deny';
  if (approval === 'auto-approve') decision = 'approve';
  else if (task.onApproval) {
    try {
      decision =
        (await abortable(Promise.resolve(task.onApproval(request, signal)), signal)) === 'approve' ? 'approve' : 'deny';
    } catch {
      decision = 'deny';
    }
  }
  if (signal.aborted) decision = 'deny';
  emit({
    type: 'approval-resolved',
    id: request.id,
    decision,
    ...(approval === 'auto-approve' ? { automatic: true } : {}),
  });
  signal.throwIfAborted();
  return decision;
}

/** JSON with sorted keys: the same arguments always read the same. */
export function stableJson(value: Record<string, unknown>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))));
}
