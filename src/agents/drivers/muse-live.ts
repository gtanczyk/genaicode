import { liveAgent, uuidv7, type LiveSession } from '../live-agent.js';
import { RpcError } from '../rpc.js';
import type { AgentOutcome } from '../runtime.js';
import type { AgentEvent, ApprovalDecision, ApprovalRequest, CodingAgent } from '../types.js';
import { isObject, stringField } from './json.js';

export interface MuseLiveOptions {
  /** Executable name or path. Default `muse`. */
  command?: string;
  /** Pass `--trust-workspace`. Default true. */
  trustWorkspace?: boolean;
  /** How long to wait for the server to acknowledge each request. Default 60 s. */
  requestTimeoutMs?: number;
}

const TOOL_KINDS = new Set(['commandExecution', 'toolCall', 'mcpToolCall', 'fileChange']);

/**
 * Muse over its JSON-RPC server (`muse serve`). Supports `steer()` and routes
 * approval requests to `task.onApproval`; without one, each request is denied.
 */
export function museLive(options: MuseLiveOptions = {}): CodingAgent {
  return liveAgent({
    name: 'muse',
    command: options.command ?? 'muse',
    capabilities: { effort: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'], approvals: true },
    args: (task) => [
      'serve',
      ...((options.trustWorkspace ?? true) ? ['--trust-workspace'] : []),
      ...(task.extraArgs ?? []),
    ],
    drive: (session) => driveMuse(session, options),
  });
}

async function driveMuse(session: LiveSession, options: MuseLiveOptions): Promise<AgentOutcome> {
  const { task, rpc } = session;
  const timeout = options.requestTimeoutMs ?? 60_000;
  // Filled in as the server replies; notifications before then are not ours.
  const ids: { session?: string; turn?: string } = {};
  let finish: (outcome: AgentOutcome) => void = () => {};
  const finished = new Promise<AgentOutcome>((resolve) => {
    finish = resolve;
  });

  const approvals = museApprovals(session, () => ids.session, timeout);

  session.onNotification((method, params) => {
    if (ids.session === undefined || stringField(params, 'sessionId') !== ids.session) return;
    if (method === 'approval/requested') return approvals.requested(params);
    if (method === 'approval/updated') return approvals.updated(params);
    if (method === 'turn/completed') {
      if (ids.turn && stringField(params, 'turnId') && stringField(params, 'turnId') !== ids.turn) return;
      const terminal = stringField(params, 'terminal');
      const error = stringField(isObject(params) ? params.error : undefined, 'message');
      if (error) session.emit({ type: 'error', message: error });
      finish(
        terminal === 'completed' ? { ok: true } : { ok: false, error: error ?? `Muse turn ${terminal ?? 'ended'}.` },
      );
      return;
    }
    for (const event of museNotification(method, params)) session.emit(event);
  });

  session.onRequest((method, params) => {
    // The server-request form of an approval wants only a presentation receipt; the
    // decision goes back as an `approval/decide` command, as for the notification form.
    if (method === 'approval/request' && stringField(params, 'sessionId') === ids.session) {
      approvals.requested(params);
      return {};
    }
    throw new RpcError('This client cannot grant this request.', -32601);
  });

  await rpc.request(
    'initialize',
    { clientInfo: { name: 'genaicode', version: '2' }, capabilities: { userInputDialogs: false } },
    timeout,
  );
  rpc.notify('initialized');

  const created = await rpc.request(
    'session/start',
    {
      commandId: uuidv7(),
      workspaceRoot: task.cwd,
      ...(task.model ? { modelId: task.model } : {}),
      approvalMode: 'onRequest',
    },
    timeout,
  );
  const sessionId = stringField(isObject(created) ? created.session : undefined, 'sessionId');
  ids.session = sessionId;
  if (!sessionId) throw new Error('Muse did not return a session id.');
  session.emit({ type: 'session', sessionId });

  const input = (text: string) => [{ type: 'text', text }];
  const started = await rpc.request(
    'turn/start',
    {
      sessionId,
      input: input(task.prompt),
      commandId: uuidv7(),
      ...(task.effort ? { reasoningEffort: task.effort } : {}),
    },
    timeout,
  );
  const turnId = stringField(started, 'turnId');
  ids.turn = turnId;
  if (!turnId) throw new Error('Muse did not return a turn id.');

  session.setSteer(async (text) => {
    const ack = await rpc.request(
      'turn/steer',
      { sessionId, expectedTurnId: turnId, input: input(text), commandId: uuidv7() },
      timeout,
    );
    if (stringField(ack, 'turnId') !== turnId)
      throw new Error('Muse did not confirm the input; it may not have arrived.');
  });
  return finished;
}

interface MuseChoice {
  choiceId: string;
  decision: string;
  scope?: string;
}

/**
 * Muse's approval round trip: an `approval/requested` notification (or `approval/request`
 * server request) offers server-minted choices, and the client answers with an
 * `approval/decide` command naming one of them. A multi-stage approval advances through
 * `approval/updated` with a new `currentRequirementId`, and each stage is decided once.
 */
function museApprovals(session: LiveSession, sessionId: () => string | undefined, timeout: number) {
  const decided = new Set<string>();
  const closed = new Set<string>();
  const requests = new Map<string, Record<string, unknown>>();
  const stages = new Map<string, number>();

  const decide = async (params: Record<string, unknown>) => {
    const approvalId = stringField(params, 'approvalId');
    const requirement = isObject(params.currentRequirementId) ? params.currentRequirementId : undefined;
    const choices = Array.isArray(params.availableChoices) ? params.availableChoices.filter(isChoice) : [];
    if (!approvalId || !requirement) return;
    const stageKey = `${approvalId} ${stringField(requirement, 'approvalId')}:${String(requirement.sourceIndex)}`;
    if (decided.has(stageKey) || closed.has(approvalId)) return;
    decided.add(stageKey);

    const stage = (stages.get(approvalId) ?? 0) + 1;
    stages.set(approvalId, stage);
    const decision = await session.approve(
      museApprovalRequest(params, stage === 1 ? approvalId : `${approvalId}/${stage}`),
    );
    // Approving for the session or for good would grant more than was asked: deny instead.
    let choice = pickChoice(choices, decision);
    if (!choice && decision === 'approve') {
      choice = pickChoice(choices, 'deny');
      session.emit({ type: 'error', message: `Muse offered no one-time approval for ${approvalId}; denying it.` });
    }
    if (!choice) {
      session.emit({ type: 'error', message: `Muse offered no choice that denies approval ${approvalId}.` });
      return;
    }
    const ack = await session.rpc.request(
      'approval/decide',
      {
        sessionId: sessionId(),
        approvalId,
        choiceId: choice.choiceId,
        requirementId: requirement,
        commandId: uuidv7(),
      },
      timeout,
    );
    // `terminal: true`: this decision closed the whole approval, so no later stage needs one.
    if (isObject(ack) && ack.terminal === true) closed.add(approvalId);
  };

  const run = (params: Record<string, unknown>) =>
    void decide(params).catch((error: unknown) =>
      session.emit({
        type: 'error',
        message: `Answering a Muse approval failed: ${error instanceof Error ? error.message : String(error)}`,
      }),
    );

  return {
    requested(params: unknown) {
      if (!isObject(params)) return;
      const approvalId = stringField(params, 'approvalId');
      if (approvalId) requests.set(approvalId, params);
      run(params);
    },
    updated(params: unknown) {
      if (!isObject(params)) return;
      const approvalId = stringField(params, 'approvalId');
      const original = approvalId ? requests.get(approvalId) : undefined;
      if (!original || (isObject(params.change) && params.change.kind === 'alreadyTerminal')) return;
      // The update carries the new stage; the tool and its arguments stay those of the request.
      run({ ...original, ...params });
    },
  };
}

function isChoice(value: unknown): value is MuseChoice {
  return isObject(value) && typeof value.choiceId === 'string' && typeof value.decision === 'string';
}

/** The narrowest matching choice: approve once rather than for the session, deny once rather than for good. */
function pickChoice(choices: MuseChoice[], decision: ApprovalDecision): MuseChoice | undefined {
  const wanted = decision === 'approve' ? ['approved'] : ['denied', 'abort'];
  const matching = choices.filter((choice) => wanted.includes(choice.decision));
  return matching.find((choice) => choice.scope === 'once') ?? matching[0];
}

function museApprovalRequest(params: Record<string, unknown>, id: string): ApprovalRequest {
  const subject = isObject(params.subject) ? params.subject : {};
  const subjectKind = stringField(subject, 'kind');
  const access = stringField(subject, 'access');
  const kind: ApprovalRequest['kind'] =
    subjectKind === 'shell' || subjectKind === 'process'
      ? 'command'
      : subjectKind === 'fileAccess' && access !== undefined && access !== 'read'
        ? 'file-change'
        : 'other';
  const summary =
    stringField(subject, 'command') ??
    stringField(subject, 'path') ??
    stringField(subject, 'target') ??
    stringField(params, 'toolName');
  return { id, kind, ...(summary ? { summary } : {}), detail: params };
}

/** Map one `muse serve` notification to agent events. */
export function museNotification(method: string, params: unknown): AgentEvent[] {
  const item = isObject(params) && isObject(params.item) ? params.item : undefined;
  if (!item) return [];
  const kind = stringField(item, 'type') ?? stringField(item, 'kind');
  const id = stringField(item, 'id');
  if (method === 'item/completed' && kind === 'agentMessage') {
    const text = stringField(item, 'text');
    return text ? [{ type: 'message', text }] : [];
  }
  if (kind && TOOL_KINDS.has(kind)) {
    const name = stringField(item, 'toolName') ?? kind;
    if (method === 'item/started') return [{ type: 'tool-start', ...(id ? { id } : {}), name }];
    if (method === 'item/completed')
      return [{ type: 'tool-end', ...(id ? { id } : {}), name, isError: item.status === 'failed' }];
  }
  return [];
}
