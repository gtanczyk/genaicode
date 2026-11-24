import { randomUUID } from 'node:crypto';
import { startLocalMcpServer } from './mcp-server.js';
import type { McpTool } from './mcp-tools.js';
import { QUESTION_CHANNEL } from './session-channels.js';
import type { AgentQuestion, ApprovalRequest, McpServer, QuestionAnswers, QuestionHandler } from './types.js';

/** The tool an agent calls to ask the person to choose. */
export const ASK_USER_TOOL = 'ask_user';

/** Default MCP server name for `startQuestionChannel()`. */
export const QUESTION_SERVER_NAME = 'genaicode_ask';

// Shared across bundles in the same process (CLI and bundled UI).
const QUESTION_CHANNEL_HANDLER = Symbol.for('genaicode.questionChannel.handler');

/** Mark an MCP server as a session-injected `ask_user` fallback, independent of its name. */
export function markQuestionChannelServer<T extends McpServer>(
  server: T,
  handler?: () => QuestionHandler | undefined,
): T {
  const existing = (server as Record<symbol, unknown>)[QUESTION_CHANNEL_HANDLER];
  const getter = handler ?? (typeof existing === 'function' ? existing : undefined);
  return Object.assign(
    { ...server },
    { [QUESTION_CHANNEL]: true as const },
    getter ? { [QUESTION_CHANNEL_HANDLER]: getter } : {},
  );
}

/** Whether `server` is a question-channel MCP server (`startQuestionChannel()` or session `questions`). */
export function isQuestionChannelServer(server: McpServer): boolean {
  return Boolean((server as Record<symbol, unknown>)[QUESTION_CHANNEL]);
}

/** Live getter for the handler bound on a `startQuestionChannel()` server, when present. */
export function questionChannelHandler(server: McpServer): (() => QuestionHandler | undefined) | undefined {
  const getter = (server as Record<symbol, unknown>)[QUESTION_CHANNEL_HANDLER];
  return typeof getter === 'function' ? (getter as () => QuestionHandler | undefined) : undefined;
}

const MAX_QUESTIONS = 4;
const MAX_OPTIONS = 8;
const MAX_TEXT = 2_000;

/**
 * `ask_user`: questions with options for the person, for agents that have no way of their own to
 * ask (Antigravity, Gemini, Muse) or have one only in some modes (Codex asks in Plan mode). The
 * call waits for the answer and returns it as text.
 */
export function askUserTool(ask: () => QuestionHandler | undefined): McpTool {
  return {
    name: ASK_USER_TOOL,
    description:
      'Ask the user to choose when a decision is theirs: which of a few approaches, which option, what to name ' +
      'something. They see a card with your options and can also type an answer of their own. The call waits ' +
      'for the answer. Ask only what you cannot decide yourself, give 2-4 clear options with one-line ' +
      'descriptions, and ask related questions in one call. Not for permission to run commands.',
    inputSchema: {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_QUESTIONS,
          items: {
            type: 'object',
            properties: {
              question: { type: 'string', description: 'The question, ending with a question mark.' },
              header: { type: 'string', description: 'A label of one or two words, e.g. "Database".' },
              options: {
                type: 'array',
                maxItems: MAX_OPTIONS,
                items: {
                  type: 'object',
                  properties: {
                    label: { type: 'string', description: 'The choice, in a few words.' },
                    description: { type: 'string', description: 'What it means, in one line.' },
                  },
                  required: ['label'],
                },
              },
              multiple: { type: 'boolean', description: 'Several options may be chosen.' },
            },
            required: ['question', 'options'],
          },
        },
      },
      required: ['questions'],
    },
    async call(args) {
      const questions = askedQuestions(args.questions);
      if (!questions)
        return 'Invalid questions: give 1-4 questions, each with a question text and options with labels.';
      const handler = ask();
      if (!handler) return 'Nobody can answer right now. Decide yourself and say what you chose.';
      const request: ApprovalRequest = {
        id: `ask-${randomUUID()}`,
        kind: 'question',
        scope: 'once',
        summary: questions[0]!.question,
        detail: { tool: ASK_USER_TOOL, questions: args.questions },
        questions,
      };
      let answers: QuestionAnswers | undefined;
      try {
        answers = await handler(request);
      } catch {
        answers = undefined;
      }
      return answerText(questions, answers);
    },
  };
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, MAX_TEXT) : undefined;
}

function askedQuestions(value: unknown): AgentQuestion[] | undefined {
  if (!Array.isArray(value) || !value.length || value.length > MAX_QUESTIONS) return undefined;
  const questions: AgentQuestion[] = [];
  for (const [index, item] of value.entries()) {
    if (typeof item !== 'object' || item === null) return undefined;
    const fields = item as Record<string, unknown>;
    const question = text(fields.question);
    const given = Array.isArray(fields.options) ? (fields.options as unknown[]) : [];
    if (!question || given.length > MAX_OPTIONS) return undefined;
    const options = [];
    for (const option of given) {
      const label = text(typeof option === 'string' ? option : (option as Record<string, unknown> | null)?.label);
      if (!label) return undefined;
      const description = text((option as Record<string, unknown> | null)?.description);
      options.push({ label, ...(description ? { description } : {}) });
    }
    const header = text(fields.header);
    questions.push({
      id: `q${index + 1}`,
      question,
      ...(header ? { header: header.slice(0, 40) } : {}),
      options,
      ...(fields.multiple === true ? { multiple: true } : {}),
      freeText: true,
    });
  }
  return questions;
}

function answerText(questions: AgentQuestion[], answers: QuestionAnswers | undefined): string {
  const lines = questions.flatMap((question) => {
    const picked = answers?.[question.id];
    return picked?.length ? [`${question.question} ${picked.join(', ')}`] : [];
  });
  if (!lines.length) return 'The user did not answer. Decide yourself and say what you chose.';
  const skipped = questions.length - lines.length;
  return `The user answered:\n${lines.join('\n')}${skipped ? `\n(${skipped} left unanswered.)` : ''}`;
}

/** The `ask_user` MCP server: give `mcpServer` to agents, `bind` the handler that shows the questions. */
export interface QuestionChannel {
  mcpServer: McpServer;
  /** Who answers from now on; undefined: nobody (calls return at once). */
  bind(handler: QuestionHandler | undefined): void;
  close(): Promise<void>;
}

/** Serve `ask_user` over MCP on a random loopback port, behind a random bearer token. */
export async function startQuestionChannel(options: { name?: string } = {}): Promise<QuestionChannel> {
  let handler: QuestionHandler | undefined;
  const server = await startLocalMcpServer({
    name: options.name ?? QUESTION_SERVER_NAME,
    tools: [askUserTool(() => handler)],
    instructions: `Use ${ASK_USER_TOOL} when a choice is the user's to make; it shows them your options.`,
  });
  return {
    // The call waits for a person: agents that can be told so wait up to a day (Codex: 60 s by default).
    // Its tool only asks the person: agents need no permission prompt in front of the question.
    mcpServer: markQuestionChannelServer({ ...server.mcpServer, toolTimeoutSec: 86_400, trusted: true }, () => handler),
    bind(next) {
      handler = next;
    },
    close: server.close,
  };
}
