import { describe, expect, it, vi } from 'vitest';
import { askApproval, type LiveApprovals, type LiveSession } from '../live-agent.js';
import { RpcError, RpcPeer } from '../rpc.js';
import type { AgentEvent, ApprovalDecision, ApprovalHandler, ApprovalRequest } from '../types.js';
import { codexApprovals } from './codex-approvals.js';
import { museApprovals } from './muse-approvals.js';

type Sent = {
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: unknown;
};

/** A live session over an in-memory peer: `deliver` plays the agent, `sent` holds what the client wrote. */
function harness(
  build: (session: LiveSession) => LiveApprovals,
  onApproval?: ApprovalHandler,
  decideAck: (params: Record<string, unknown>) => unknown = () => ({ terminal: true }),
) {
  const sent: Sent[] = [];
  const events: AgentEvent[] = [];
  const lifetime = new AbortController();
  const task = { prompt: 'p', cwd: '.', onApproval };
  const rpc: RpcPeer = new RpcPeer(
    (line) => {
      const message = JSON.parse(line) as Sent;
      sent.push(message);
      if (message.method === 'approval/decide')
        queueMicrotask(() => rpc.receive({ jsonrpc: '2.0', id: message.id, result: decideAck(message.params!) }));
    },
    {
      notification: (method, params) => approvals.notification(method, params),
      request: (method, params, context) =>
        approvals.request(method, params, context) ?? Promise.reject(new RpcError('unsupported', -32601)),
    },
  );
  const session: LiveSession = {
    task,
    rpc,
    signal: lifetime.signal,
    emit: (event) => events.push(event),
    onNotification() {},
    onRequest() {},
    approve: (request, signal) =>
      askApproval(task, request, signal ? AbortSignal.any([lifetime.signal, signal]) : lifetime.signal),
    setSteer() {},
  };
  const approvals = build(session);
  let nextId = 100;
  const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
  return {
    sent,
    events,
    approvals,
    lifetime,
    settle,
    /** Send a server request and wait for the client's answer. */
    async request(method: string, params: unknown, id: number = nextId++) {
      rpc.receive({ jsonrpc: '2.0', id, method, params });
      for (let i = 0; i < 200; i++) {
        const reply = sent.find((message) => message.id === id && !message.method);
        if (reply) return reply;
        await settle();
      }
      throw new Error(`no reply to ${method}`);
    },
    notify(method: string, params: unknown) {
      rpc.receive({ jsonrpc: '2.0', method, params });
    },
    decides: () => sent.filter((message) => message.method === 'approval/decide').map((message) => message.params!),
  };
}

/** A handler that holds each question until the test answers it. */
function held() {
  const asked: { request: ApprovalRequest; signal: AbortSignal; answer(decision: ApprovalDecision): void }[] = [];
  const handler: ApprovalHandler = (request, signal) =>
    new Promise((resolve) => asked.push({ request, signal: signal!, answer: resolve }));
  return { asked, handler };
}

describe('codexApprovals', () => {
  const ids = { session: 'th-1', turn: 'tu-1' };
  const codex = (onApproval?: ApprovalHandler) => harness((session) => codexApprovals(session, () => ids), onApproval);
  const command = {
    threadId: 'th-1',
    turnId: 'tu-1',
    itemId: 'c1',
    approvalId: null,
    command: 'rm -rf build',
    cwd: '/w',
    reason: 'cleanup',
  };

  it('accepts or declines a command with the request passed through unchanged', async () => {
    const onApproval = vi.fn<ApprovalHandler>().mockResolvedValueOnce('approve').mockResolvedValueOnce('deny');
    const h = codex(onApproval);
    expect((await h.request('item/commandExecution/requestApproval', command)).result).toEqual({ decision: 'accept' });
    expect((await h.request('item/commandExecution/requestApproval', command)).result).toEqual({ decision: 'decline' });
    expect(onApproval.mock.calls[0]![0]).toEqual({
      id: 'c1',
      kind: 'command',
      scope: 'once',
      summary: 'rm -rf build',
      detail: command,
    });
    expect(onApproval.mock.calls[0]![1]).toBeInstanceOf(AbortSignal);
  });

  it('answers file changes, and the legacy protocol in its own vocabulary', async () => {
    const h = codex(() => 'approve');
    const change = { threadId: 'th-1', turnId: 'tu-1', itemId: 'f1', reason: null, grantRoot: null };
    expect((await h.request('item/fileChange/requestApproval', change)).result).toEqual({ decision: 'accept' });
    const legacy = { conversationId: 'th-1', callId: 'x1', approvalId: null, command: ['ls', '-la'], cwd: '/w' };
    expect((await h.request('execCommandApproval', legacy)).result).toEqual({ decision: 'approved' });
  });

  it('grants a permission profile for the turn, without the categories left null', async () => {
    const onApproval = vi.fn<ApprovalHandler>(() => 'approve');
    const h = codex(onApproval);
    const params = {
      threadId: 'th-1',
      turnId: 'tu-1',
      itemId: 'p1',
      environmentId: null,
      startedAtMs: 1,
      cwd: '/w',
      reason: 'needs npm',
      permissions: { network: { enabled: true }, fileSystem: null },
    };
    expect((await h.request('item/permissions/requestApproval', params)).result).toEqual({
      permissions: { network: { enabled: true } },
      scope: 'turn',
    });
    expect(onApproval.mock.calls[0]![0]).toMatchObject({
      id: 'p1',
      kind: 'other',
      scope: 'turn',
      summary: 'Permissions for this turn: network (needs npm)',
      detail: params,
    });
  });

  it('grants nothing when a permission profile is denied, unanswered or invalid', async () => {
    const params = {
      threadId: 'th-1',
      turnId: 'tu-1',
      itemId: 'p1',
      reason: null,
      permissions: { network: { enabled: true }, fileSystem: { read: ['/etc'], write: null } },
    };
    expect((await codex(() => 'deny').request('item/permissions/requestApproval', params)).result).toEqual({
      permissions: {},
      scope: 'turn',
    });
    expect((await codex().request('item/permissions/requestApproval', params)).result).toEqual({
      permissions: {},
      scope: 'turn',
    });
    const thrown = codex(() => {
      throw new Error('ui crashed');
    });
    expect((await thrown.request('item/permissions/requestApproval', params)).result).toEqual({
      permissions: {},
      scope: 'turn',
    });
    const handler = vi.fn<ApprovalHandler>(() => 'approve');
    const invalid = await codex(handler).request('item/permissions/requestApproval', {
      ...params,
      permissions: { network: true },
    });
    expect(invalid.error).toMatchObject({ code: -32602 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('rejects approvals for another thread or turn without asking', async () => {
    const handler = vi.fn<ApprovalHandler>(() => 'approve');
    const h = codex(handler);
    expect(
      (await h.request('item/commandExecution/requestApproval', { ...command, threadId: 'other' })).error,
    ).toMatchObject({
      code: -32602,
    });
    expect(
      (await h.request('item/commandExecution/requestApproval', { ...command, turnId: 'old' })).error,
    ).toMatchObject({
      code: -32602,
    });
    expect(h.approvals.request('item/tool/requestUserInput', command)).toBeUndefined();
    expect(handler).not.toHaveBeenCalled();
  });

  it('declines an answer that arrives after the turn ended', async () => {
    const { asked, handler } = held();
    const h = codex(handler);
    const reply = h.request('item/permissions/requestApproval', {
      threadId: 'th-1',
      turnId: 'tu-1',
      itemId: 'p1',
      permissions: { network: { enabled: true }, fileSystem: null },
    });
    await h.settle();
    h.approvals.close();
    expect(asked[0]!.signal.aborted).toBe(true);
    asked[0]!.answer('approve');
    expect((await reply).result).toEqual({ permissions: {}, scope: 'turn' });
  });

  it('declines an answer that arrives once another turn is running', async () => {
    const current = { session: 'th-1', turn: 'tu-1' };
    const { asked, handler } = held();
    const h = harness((session) => codexApprovals(session, () => current), handler);
    const reply = h.request('item/commandExecution/requestApproval', command);
    await h.settle();
    current.turn = 'tu-2';
    asked[0]!.answer('approve');
    expect((await reply).result).toEqual({ decision: 'decline' });
  });

  it('withdraws the question when the server resolves the request itself', async () => {
    const { asked, handler } = held();
    const h = codex(handler);
    const reply = h.request('item/commandExecution/requestApproval', command, 7);
    await h.settle();
    expect(h.approvals.notification('serverRequest/resolved', { threadId: 'other', requestId: 7 })).toBe(true);
    expect(asked[0]!.signal.aborted).toBe(false);
    h.notify('serverRequest/resolved', { threadId: 'th-1', requestId: 7 });
    expect(asked[0]!.signal.aborted).toBe(true);
    expect((await reply).result).toEqual({ decision: 'decline' });
  });

  it('withdraws the question when the process exits', async () => {
    const { asked, handler } = held();
    const h = codex(handler);
    const reply = h.request('item/commandExecution/requestApproval', command);
    await h.settle();
    h.lifetime.abort();
    expect(asked[0]!.signal.aborted).toBe(true);
    expect((await reply).result).toEqual({ decision: 'decline' });
  });
});

describe('museApprovals', () => {
  const ids = { session: 'se-1', turn: 'tu-1' };
  const choices = [
    { choiceId: 'c-session', decision: 'approvedForSession', scope: 'session', label: 'Always' },
    { choiceId: 'c-once', decision: 'approved', scope: 'once', label: 'Allow' },
    { choiceId: 'c-deny', decision: 'denied', scope: 'once', label: 'Deny' },
  ];
  const approval = {
    sessionId: 'se-1',
    turnId: 'tu-1',
    approvalId: 'ap-1',
    itemId: 'i1',
    toolName: 'shell',
    rawArgs: '{"command":"git push"}',
    subject: { kind: 'shell', command: 'git push' },
    currentRequirementId: { approvalId: 'ap-1', sourceIndex: 0 },
    availableChoices: choices,
  };
  const muse = (onApproval?: ApprovalHandler, ack?: (params: Record<string, unknown>) => unknown) =>
    harness((session) => museApprovals(session, () => ids), onApproval, ack);

  it('acknowledges the server request, asks once per stage and decides with the server ids', async () => {
    const onApproval = vi.fn<ApprovalHandler>(() => 'approve');
    const h = muse(onApproval);
    h.notify('approval/requested', approval);
    expect((await h.request('approval/request', approval)).result).toEqual({});
    await h.settle();
    expect(onApproval).toHaveBeenCalledTimes(1);
    expect(onApproval.mock.calls[0]![0]).toEqual({
      id: 'ap-1',
      kind: 'command',
      scope: 'once',
      summary: 'git push',
      detail: approval,
    });
    expect(h.decides()).toEqual([
      {
        sessionId: 'se-1',
        approvalId: 'ap-1',
        choiceId: 'c-once',
        requirementId: { approvalId: 'ap-1', sourceIndex: 0 },
        commandId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      },
    ]);
  });

  it('decides each stage of a multi-stage approval once', async () => {
    const onApproval = vi.fn<ApprovalHandler>(() => 'approve');
    const h = muse(onApproval, (params) => ({
      terminal: (params.requirementId as { sourceIndex: number }).sourceIndex === 1,
    }));
    h.notify('approval/requested', approval);
    await h.settle();
    const stage2 = {
      sessionId: 'se-1',
      approvalId: 'ap-1',
      change: { kind: 'stageResolved' },
      availableChoices: choices,
      currentRequirementId: { approvalId: 'ap-1', sourceIndex: 1 },
      subject: { kind: 'network', target: 'github.com' },
    };
    h.notify('approval/updated', stage2);
    h.notify('approval/updated', stage2);
    await h.settle();
    expect(onApproval.mock.calls.map(([request]) => [request.id, request.summary])).toEqual([
      ['ap-1', 'git push'],
      ['ap-1/2', 'github.com'],
    ]);
    // Identity from the request, the stage from the update.
    expect((onApproval.mock.calls[1]![0].detail as Record<string, unknown>).toolName).toBe('shell');
    expect(h.decides().map((params) => params.requirementId)).toEqual([
      { approvalId: 'ap-1', sourceIndex: 0 },
      { approvalId: 'ap-1', sourceIndex: 1 },
    ]);
    // A trailing update after the terminal decision asks nothing.
    h.notify('approval/updated', { ...stage2, currentRequirementId: { approvalId: 'ap-1', sourceIndex: 2 } });
    await h.settle();
    expect(onApproval).toHaveBeenCalledTimes(2);
  });

  it('denies rather than approving for the session', async () => {
    const h = muse(() => 'approve');
    h.notify('approval/requested', { ...approval, availableChoices: [choices[0], choices[2]] });
    await h.settle();
    expect(h.decides().map((params) => params.choiceId)).toEqual(['c-deny']);
    expect(h.events).toContainEqual({ type: 'error', message: expect.stringContaining('no one-time approval') });
  });

  it('denies without a handler, and when the handler throws', async () => {
    const none = muse();
    none.notify('approval/requested', approval);
    const thrown = muse(() => {
      throw new Error('ui crashed');
    });
    thrown.notify('approval/requested', approval);
    await none.settle();
    expect(none.decides().map((params) => params.choiceId)).toEqual(['c-deny']);
    expect(thrown.decides().map((params) => params.choiceId)).toEqual(['c-deny']);
  });

  it('ignores approvals of another session or turn', async () => {
    const handler = vi.fn<ApprovalHandler>(() => 'approve');
    const h = muse(handler);
    h.notify('approval/requested', { ...approval, sessionId: 'other' });
    h.notify('approval/requested', { ...approval, turnId: 'old' });
    expect((await h.request('approval/request', { ...approval, sessionId: 'other' })).error).toMatchObject({
      code: -32602,
    });
    await h.settle();
    expect(handler).not.toHaveBeenCalled();
    expect(h.decides()).toEqual([]);
  });

  it('withdraws the question when the approval is resolved elsewhere or already terminal', async () => {
    for (const [method, params] of [
      ['approval/resolved', { sessionId: 'se-1', approvalId: 'ap-1', decision: 'denied', resolvedBy: 'policy' }],
      ['approval/updated', { ...approval, change: { kind: 'alreadyTerminal' } }],
    ] as const) {
      const { asked, handler } = held();
      const h = muse(handler);
      h.notify('approval/requested', approval);
      await h.settle();
      h.notify(method, params);
      expect(asked[0]!.signal.aborted).toBe(true);
      asked[0]!.answer('approve');
      await h.settle();
      expect(h.decides()).toEqual([]);
    }
  });

  it('sends no decision once the turn has ended', async () => {
    const { asked, handler } = held();
    const h = muse(handler);
    h.notify('approval/requested', approval);
    await h.settle();
    h.approvals.close();
    expect(asked[0]!.signal.aborted).toBe(true);
    asked[0]!.answer('approve');
    await h.settle();
    expect(h.decides()).toEqual([]);
    h.notify('approval/requested', { ...approval, approvalId: 'ap-2' });
    await h.settle();
    expect(asked).toHaveLength(1);
  });
});
