import type { LiveApprovalIds, LiveApprovals, LiveSession } from '../live-agent.js';
import { RpcError } from '../rpc.js';
import type { ApprovalRequest } from '../types.js';
import { isObject, stringField, type JsonObject } from './json.js';

const KINDS: Record<string, ApprovalRequest['kind']> = {
  'item/commandExecution/requestApproval': 'command',
  'item/fileChange/requestApproval': 'file-change',
  'item/permissions/requestApproval': 'other',
  // The v1 protocol, kept for older servers.
  execCommandApproval: 'command',
  applyPatchApproval: 'file-change',
};
const LEGACY = new Set(['execCommandApproval', 'applyPatchApproval']);

/**
 * Codex app-server approvals (`codex app-server`, v2 protocol). Commands and file changes
 * are answered `accept` / `decline`. A permission profile request
 * (`item/permissions/requestApproval`) asks with `scope: 'turn'`: approving grants the
 * requested categories for the current turn, denying grants none. A request from another
 * thread or turn is rejected; an answer that arrives after the turn ended or after the
 * server withdrew the request (`serverRequest/resolved`) declines.
 */
export function codexApprovals(session: LiveSession, ids: () => LiveApprovalIds): LiveApprovals {
  const turn = new AbortController();
  let count = 0;

  const ownThread = (params: unknown) => {
    const thread = ids().session;
    if (!thread) return false;
    return (stringField(params, 'threadId') ?? stringField(params, 'conversationId')) === thread;
  };
  const ownTurn = (params: unknown) => {
    const current = ids().turn;
    const requested = stringField(params, 'turnId');
    return ownThread(params) && (!requested || !current || requested === current);
  };
  // Asked again after the decision: the turn may have ended while the question was open.
  const stillOpen = (params: unknown) => !turn.signal.aborted && !session.signal.aborted && ownTurn(params);

  const answer = async (method: string, params: JsonObject, signal: AbortSignal): Promise<unknown> => {
    if (method === 'item/permissions/requestApproval') {
      const requested = isObject(params.permissions) ? params.permissions : undefined;
      const itemId = stringField(params, 'itemId');
      if (!requested || !itemId || Object.values(requested).some((value) => value !== null && !isObject(value)))
        throw new RpcError('Invalid permission profile request.', -32602);
      const decision = await session.approve(
        { id: itemId, kind: 'other', scope: 'turn', summary: permissionSummary(params, requested), detail: params },
        signal,
      );
      // Only what was asked for, without the categories the request left null.
      const granted =
        decision === 'approve' && stillOpen(params)
          ? Object.fromEntries(Object.entries(requested).filter(([, value]) => value != null))
          : {};
      return { permissions: granted, scope: 'turn' };
    }
    const request: ApprovalRequest = {
      // One item can raise several approvals (e.g. per shell subcommand); `approvalId` tells them apart.
      id:
        stringField(params, 'approvalId') ??
        stringField(params, 'itemId') ??
        stringField(params, 'callId') ??
        `approval-${++count}`,
      kind: KINDS[method]!,
      scope: 'once',
      ...summaryOf(params),
      detail: params,
    };
    const approved = (await session.approve(request, signal)) === 'approve' && stillOpen(params);
    if (LEGACY.has(method)) return { decision: approved ? 'approved' : 'denied' };
    return { decision: approved ? 'accept' : 'decline' };
  };

  return {
    request(method, params, context) {
      if (!KINDS[method]) return undefined;
      if (!isObject(params) || !ownTurn(params))
        return Promise.reject(new RpcError('This approval does not belong to the running turn.', -32602));
      const signal = context ? AbortSignal.any([turn.signal, context.signal]) : turn.signal;
      return answer(method, params, signal);
    },
    notification(method, params) {
      if (method !== 'serverRequest/resolved') return false;
      const id = isObject(params) ? params.requestId : undefined;
      if (ownThread(params) && (typeof id === 'string' || typeof id === 'number')) session.rpc.cancel(id);
      return true;
    },
    close() {
      turn.abort();
    },
  };
}

function summaryOf(params: JsonObject): { summary?: string } {
  const command = params.command;
  const text = Array.isArray(command) ? command.join(' ') : typeof command === 'string' ? command : undefined;
  const summary = text ?? stringField(params, 'reason') ?? stringField(params, 'grantRoot');
  return summary ? { summary } : {};
}

function permissionSummary(params: JsonObject, requested: JsonObject): string {
  const categories = Object.entries(requested)
    .filter(([, value]) => value != null)
    .map(([name]) => name);
  const reason = stringField(params, 'reason');
  return `Permissions for this turn: ${categories.join(', ') || 'none'}${reason ? ` (${reason})` : ''}`;
}
