import { uuidv7, type LiveApprovalIds, type LiveApprovals, type LiveSession } from '../live-agent.js';
import { RpcError } from '../rpc.js';
import type { ApprovalDecision, ApprovalRequest } from '../types.js';
import { isObject, stringField, type JsonObject } from './json.js';
import { anySignal } from '../runtime.js';

export interface MuseApprovalOptions {
  /** How long to wait for the server to acknowledge `approval/decide`. Default 60 s. */
  requestTimeoutMs?: number;
  /** A decision could not be delivered. Default: emit it as an `error` event. */
  onError?(message: string): void;
}

interface MuseChoice {
  choiceId: string;
  decision: string;
  scope?: string;
}

/**
 * Muse approvals (`muse serve`). An `approval/requested` notification, or the
 * `approval/request` server request (answered with a bare receipt), offers server-minted
 * choices; the decision goes back as an `approval/decide` command naming one of them and
 * the stage's `currentRequirementId`. A multi-stage approval advances through
 * `approval/updated`, and each stage is asked once however often it is delivered.
 *
 * Approving picks only a choice scoped `once`: a request that offers nothing narrower than
 * the session is denied. `approval/resolved` (decided elsewhere) and `alreadyTerminal`
 * updates withdraw the open question.
 */
export function museApprovals(
  session: LiveSession,
  ids: () => LiveApprovalIds,
  options: MuseApprovalOptions = {},
): LiveApprovals {
  const timeout = options.requestTimeoutMs ?? 60_000;
  const fail = options.onError ?? ((message: string) => session.emit({ type: 'error', message }));
  const turn = new AbortController();
  const requests = new Map<string, JsonObject>();
  const decided = new Set<string>();
  const closed = new Set<string>();
  const stages = new Map<string, number>();
  const questions = new Map<string, AbortController>();

  const ownSession = (params: unknown) =>
    ids().session !== undefined && stringField(params, 'sessionId') === ids().session;
  const ownTurn = (params: unknown) => {
    const current = ids().turn;
    const requested = stringField(params, 'turnId');
    return ownSession(params) && (!requested || !current || requested === current);
  };
  const withdraw = (approvalId: string) => {
    closed.add(approvalId);
    questions.get(approvalId)?.abort();
  };

  const decide = async (params: JsonObject) => {
    const approvalId = stringField(params, 'approvalId');
    const requirement = isObject(params.currentRequirementId) ? params.currentRequirementId : undefined;
    if (!approvalId || !requirement) return fail('Muse sent an approval without an approval or requirement id.');
    const stageKey = `${approvalId} ${stringField(requirement, 'approvalId')}:${String(requirement.sourceIndex)}`;
    if (decided.has(stageKey) || closed.has(approvalId) || turn.signal.aborted) return;
    decided.add(stageKey);

    const stage = (stages.get(approvalId) ?? 0) + 1;
    stages.set(approvalId, stage);
    // Choices are read from a copy: the handler sees `detail` and must not change them.
    const choices = Array.isArray(params.availableChoices)
      ? (structuredClone(params.availableChoices) as unknown[]).filter(isChoice)
      : [];
    const question = new AbortController();
    questions.set(approvalId, question);
    let decision: ApprovalDecision;
    try {
      decision = await session.approve(
        museApprovalRequest(params, stage === 1 ? approvalId : `${approvalId}/${stage}`),
        anySignal([turn.signal, question.signal]),
      );
    } finally {
      if (questions.get(approvalId) === question) questions.delete(approvalId);
    }
    // Withdrawn, decided elsewhere, or the turn is over: there is nothing left to answer.
    if (question.signal.aborted || closed.has(approvalId) || turn.signal.aborted || session.signal.aborted) return;
    if (!ownTurn(params)) return;

    let choice = pickChoice(choices, decision);
    if (!choice && decision === 'approve') {
      choice = pickChoice(choices, 'deny');
      fail(`Muse offered no one-time approval for ${approvalId}; denying it.`);
    }
    if (!choice) return fail(`Muse offered no choice that denies approval ${approvalId}.`);
    const ack = await session.rpc.request(
      'approval/decide',
      {
        sessionId: ids().session,
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

  const run = (params: JsonObject) =>
    void decide(params).catch((error: unknown) =>
      fail(`Answering a Muse approval failed: ${error instanceof Error ? error.message : String(error)}`),
    );

  const requested = (params: JsonObject) => {
    const approvalId = stringField(params, 'approvalId');
    if (approvalId && !requests.has(approvalId)) requests.set(approvalId, params);
    run(params);
  };

  return {
    request(method, params) {
      if (method !== 'approval/request') return undefined;
      if (!isObject(params) || !ownTurn(params))
        return Promise.reject(new RpcError('This approval does not belong to the running turn.', -32602));
      // The server request wants only a presentation receipt; the decision is a separate command.
      requested(params);
      return Promise.resolve({});
    },
    notification(method, params) {
      if (method !== 'approval/requested' && method !== 'approval/updated' && method !== 'approval/resolved')
        return false;
      if (!isObject(params) || !ownSession(params)) return true;
      const approvalId = stringField(params, 'approvalId');
      if (method === 'approval/resolved') {
        if (approvalId) withdraw(approvalId);
        return true;
      }
      if (method === 'approval/requested') {
        if (ownTurn(params)) requested(params);
        return true;
      }
      const original = approvalId ? requests.get(approvalId) : undefined;
      if (isObject(params.change) && params.change.kind === 'alreadyTerminal') {
        if (approvalId) withdraw(approvalId);
        return true;
      }
      // The update carries the new stage; the tool and its arguments stay those of the request.
      if (original) run({ ...original, ...params });
      return true;
    },
    close() {
      turn.abort();
    },
  };
}

function isChoice(value: unknown): value is MuseChoice {
  return isObject(value) && typeof value.choiceId === 'string' && typeof value.decision === 'string';
}

/** Approve once and never for the session; deny once where offered, else as the server offers. */
function pickChoice(choices: MuseChoice[], decision: ApprovalDecision): MuseChoice | undefined {
  if (decision === 'approve')
    return choices.find((choice) => choice.decision === 'approved' && choice.scope === 'once');
  const denials = choices.filter((choice) => choice.decision === 'denied' || choice.decision === 'abort');
  return denials.find((choice) => choice.decision === 'denied' && choice.scope === 'once') ?? denials[0];
}

function museApprovalRequest(params: JsonObject, id: string): ApprovalRequest {
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
  return { id, kind, scope: 'once', ...(summary ? { summary } : {}), detail: params };
}
