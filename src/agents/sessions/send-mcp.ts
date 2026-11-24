import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { McpInputRequired, type McpCallContext, type McpTool, type ToolOutput } from '../mcp-tools.js';
import type { CodingAgent } from '../types.js';
import {
  SessionSendGate,
  sessionSendTool,
  type SessionSendTarget,
  type SessionSendToolOptions,
  type SessionSendUpdate,
} from './send-tool.js';

/** The key of the one question asked: may this message go? */
const CONFIRM = 'confirm_send';

/** Whether the client can show the user a form to answer (MCP elicitation, form mode). */
function canAsk(context: McpCallContext | undefined): boolean {
  const elicitation = context?.capabilities.elicitation;
  if (typeof elicitation !== 'object' || elicitation === null) return false;
  // Declared with no mode named means forms.
  return Object.keys(elicitation).length === 0 || 'form' in elicitation;
}

/**
 * `sessions_send` for an agent that has the session index as an MCP server of its own (`genaicode
 * sessions mcp --send`), where no chat of genaicode's stands between the agent and the user. The
 * first message to each session is put to the user through the agent's own client (MCP
 * elicitation): the recipient and the exact text, to accept or decline. A client that cannot ask
 * gets nothing sent. The other session's answer comes back as an MCP task where the client takes
 * tasks, so the agent goes on working meanwhile; otherwise the call waits for it a while.
 */
export function sessionSendMcpTool(agents: readonly CodingAgent[], options: SessionSendToolOptions = {}): McpTool {
  const gate = new SessionSendGate();
  // Signs what the user was asked, so an answer cannot be moved to another message or session.
  const secret = randomBytes(32);
  const sign = (target: SessionSendTarget, text: string) =>
    createHmac('sha256', secret)
      .update(JSON.stringify([target.source, target.id, text]))
      .digest('base64url');
  const signed = (state: string | undefined, target: SessionSendTarget, text: string) => {
    const given = Buffer.from(state ?? '');
    const expected = Buffer.from(sign(target, text));
    return given.length === expected.length && timingSafeEqual(given, expected);
  };
  // One call at a time asks: the gate's question is answered from that call's request.
  let asking: McpCallContext | undefined;
  let line: Promise<unknown> = Promise.resolve();
  gate.attach({
    confirm: async (target, text, confirmOptions) => {
      const context = asking;
      const answer = context?.inputResponses?.[CONFIRM];
      if (answer !== undefined && signed(context?.requestState, target, text)) {
        return typeof answer === 'object' && answer !== null && (answer as { action?: unknown }).action === 'accept';
      }
      const where = `${target.agent} session${target.title ? ` "${target.title}"` : ''} in ${target.cwd}`;
      const when = confirmOptions?.queued ? ' It is working now, so the message goes as its next turn.' : '';
      throw new McpInputRequired(
        {
          [CONFIRM]: {
            method: 'elicitation/create',
            params: {
              mode: 'form',
              message: `Send this message to the ${where}?${when} Later messages to that session go without asking.\n\n${text}`,
              requestedSchema: { type: 'object', properties: {} },
            },
          },
        },
        sign(target, text),
      );
    },
  });
  const inner = sessionSendTool(agents, gate, options);
  return {
    name: inner.name,
    description:
      "Send a message to another local coding-agent session, as a new turn in it, when the user asks you to tell, ask or pass something to it. Find the session with sessions_list or sessions_waiting first and use its full id. The user is asked to confirm the first message to each session, with the recipient and the exact text. A session that is working right now gets the message queued as its next turn. The result is that session's answer; if it is still working when the tool returns, read the answer later with sessions_read. Send only what the user asked you to send.",
    inputSchema: inner.inputSchema,
    call(args, context) {
      if (!canAsk(context)) {
        throw new Error(
          'Nothing was sent: this client cannot ask the user to confirm a message to another session (MCP elicitation). The user can send it with: genaicode sessions send <id> "<text>".',
        );
      }
      const run = async (): Promise<ToolOutput> => {
        let settle!: (reply: ToolOutput) => void;
        let fail!: (error: Error) => void;
        const result = new Promise<ToolOutput>((resolve, reject) => {
          settle = resolve;
          fail = reject;
        });
        // Nobody may be listening yet when it fails.
        result.catch(() => undefined);
        let doing: string | undefined;
        const watch = (state: SessionSendUpdate) => {
          doing = state.status === 'queued' ? 'Queued' : (state.tool ?? state.activity ?? 'Working');
          if (state.status === 'answered') settle(state.reply || '(It answered with no text.)');
          else if (state.status === 'failed') fail(new Error(state.error ?? 'The message could not be delivered.'));
        };
        asking = context;
        let said: string;
        try {
          said = await inner.send(args, watch);
        } finally {
          asking = undefined;
        }
        if (said.startsWith('The user did not allow')) return said;
        const text = said.startsWith('Queued')
          ? 'Queued: that session is working now, so the message goes as its next turn. If no answer follows here, read it later with sessions_read.'
          : 'Sent. That session is answering now. If no answer follows here, read it later with sessions_read.';
        return { text, task: { result, status: () => doing } };
      };
      // In order: `asking` belongs to one call until its question is settled.
      const work = line.then(run, run);
      line = work.catch(() => undefined);
      return work;
    },
  };
}
