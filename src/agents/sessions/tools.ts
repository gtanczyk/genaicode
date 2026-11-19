import { createInterface } from 'node:readline';
import { handleMcpMessage, type McpTool } from '../mcp-tools.js';
import { oneLine } from './files.js';
import { groupSessions } from './group.js';
import { findSession, listSessions, readSession } from './index.js';
import type { SessionInfo, SessionSource } from './types.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface SessionToolsOptions {
  /** Environment that says where the stores are. Default `process.env`. */
  env?: NodeJS.ProcessEnv;
  now?: () => number;
}

/**
 * The session index as MCP tools, so an agent can answer "what is open, and what waits for me?"
 * across every agent on this machine: `sessions_projects`, `sessions_list` and `sessions_read`.
 * They only read. What they return is what other agents' sessions said, so give them to an agent
 * you would show those sessions to.
 */
export function sessionTools(sources: readonly SessionSource[], options: SessionToolsOptions = {}): McpTool[] {
  const now = options.now ?? Date.now;
  const query = (days: number) => ({
    since: now() - days * DAY_MS,
    ...(options.env ? { env: options.env } : {}),
  });
  const agents = [...new Set(sources.map((source) => source.name))].join(', ');

  return [
    {
      name: 'sessions_projects',
      description: `Projects (directories or repositories) that coding agents on this machine worked in lately, newest first, with how many sessions each has per agent and how many are active, wait for the user, ask for approval or were left unfinished. Agents read: ${agents}. Start here for "what is going on?" and "what waits for me?".`,
      inputSchema: {
        type: 'object',
        properties: {
          days: { type: 'number', description: 'Look back this many days. Default 14.' },
          limit: { type: 'number', description: 'At most this many projects. Default 30.' },
        },
      },
      async call(args) {
        const days = positive(args.days, 14, 365);
        const { sessions, errors } = await listSessions(sources, query(days));
        const projects = groupSessions(sessions).slice(0, positive(args.limit, 30, 200));
        if (!projects.length) return `No sessions in the last ${days} days.${unread(errors)}`;
        const lines = projects.map((project) => {
          const counts = Object.entries(project.agents)
            .map(([agent, count]) => `${agent} ${count}`)
            .join(', ');
          const states = tally(project.sessions);
          return `${project.name}  ${project.key || '(no directory)'}  last ${ago(now() - project.updatedAt)} ago  [${counts}]${states ? `  ${states}` : ''}`;
        });
        return `${projects.length} project${projects.length === 1 ? '' : 's'}, last ${days} days:\n${lines.join('\n')}${unread(errors)}`;
      },
    },
    {
      name: 'sessions_list',
      description:
        'Sessions of coding agents on this machine, newest first: agent, id, state, project directory, title or latest prompt, and the end of the agent\'s latest message. Filter by project, agent, state or text. State "approval" is a session whose agent asks whether it may use a tool; "waiting" one where the agent had the last word; "unfinished" one that stops at the user\'s message or mid-work; "active" one being worked in now.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Part of the project directory, repository or its name.' },
          agent: { type: 'string', description: `One of: ${agents}.` },
          state: { type: 'string', enum: ['active', 'waiting', 'approval', 'unfinished'] },
          text: { type: 'string', description: 'Words that the title, a prompt or the latest message contains.' },
          days: { type: 'number', description: 'Look back this many days. Default 7.' },
          limit: { type: 'number', description: 'At most this many sessions. Default 20, at most 100.' },
        },
      },
      async call(args) {
        const days = positive(args.days, 7, 365);
        const { sessions, errors } = await listSessions(sources, query(days));
        const project = lower(args.project);
        const agent = lower(args.agent);
        const text = lower(args.text);
        const state = lower(args.state);
        const matching = sessions.filter((session) => {
          if (agent && session.agent.toLowerCase() !== agent && session.source.toLowerCase() !== agent) return false;
          if (project && !`${session.cwd ?? ''} ${session.repository ?? ''}`.toLowerCase().includes(project)) {
            return false;
          }
          if (state && stateOf(session) !== state) return false;
          if (text) {
            const said = [session.title, session.firstPrompt, session.lastPrompt, session.lastReply].join(' ');
            if (!said.toLowerCase().includes(text)) return false;
          }
          return true;
        });
        const shown = matching.slice(0, positive(args.limit, 20, 100));
        if (!shown.length) return `No matching sessions in the last ${days} days.${unread(errors)}`;
        const lines = shown.map((session) => {
          const state = stateOf(session);
          const asks = session.waitingFor === 'approval' && session.waitingTool ? ` (${session.waitingTool})` : '';
          const label = session.title ?? session.lastPrompt ?? session.firstPrompt ?? '(no prompt)';
          const reply = session.lastReply ? `\n    agent: ${oneLine(session.lastReply, 240)}` : '';
          const asked =
            session.title && session.lastPrompt ? `\n    latest prompt: ${oneLine(session.lastPrompt, 240)}` : '';
          return `- ${session.agent} ${session.id}  ${state ?? 'no state'}${asks}  ${ago(now() - session.updatedAt)} ago  ${session.cwd ?? session.repository ?? ''}\n    ${oneLine(label, 160)}${asked}${reply}`;
        });
        const more = matching.length > shown.length ? `\n(${matching.length - shown.length} more match.)` : '';
        return `${lines.join('\n')}${more}${unread(errors)}`;
      },
    },
    {
      name: 'sessions_read',
      description:
        "What was said in one session: the user's prompts, the agent's messages and the tools it used, oldest first (the latest turns of a long session). Give the id from sessions_list; the start of an id (8 characters or more) is enough.",
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Session id, or its first 8 or more characters.' },
          turns: { type: 'number', description: 'At most this many of the latest turns. Default 10, at most 50.' },
        },
        required: ['id'],
      },
      async call(args) {
        const id = typeof args.id === 'string' ? args.id.trim() : '';
        if (!id) throw new Error('sessions_read needs the id of a session.');
        const found = await findSession(sources, id, options.env ? { env: options.env } : {});
        if (!found) throw new Error(`No session with id ${id}.`);
        const { session } = found;
        const turns = await readSession(sources, session, {
          maxTurns: positive(args.turns, 10, 50),
          maxToolOutput: 400,
        });
        const head = `${session.agent} ${session.id}  ${stateOf(session) ?? 'no state'}  ${session.cwd ?? session.repository ?? ''}${session.title ? `\n${oneLine(session.title, 160)}` : ''}`;
        if (!turns.length) return `${head}\n(Nothing readable was said in it.)`;
        const body = turns.map((turn) => {
          const lines = [`## User\n${cut(turn.prompt, 2000)}`];
          const tools: string[] = [];
          const flush = () => {
            if (tools.length) lines.push(`(tools: ${tools.splice(0).join(', ')})`);
          };
          for (const entry of turn.entries) {
            if (entry.kind === 'tool') tools.push(entry.isError ? `${entry.name} failed` : entry.name);
            else if (entry.kind === 'text' && entry.text.trim()) {
              flush();
              lines.push(`## ${turn.agent}\n${cut(entry.text, 3000)}`);
            }
          }
          flush();
          return lines.join('\n');
        });
        return `${head}\n\n${body.join('\n\n')}`;
      },
    },
  ];
}

/**
 * Serve `tools` over MCP on stdio (one JSON message per line), until the input ends. This is what
 * `genaicode sessions mcp` runs, for an agent's own MCP configuration.
 */
export async function serveMcpStdio(
  tools: readonly McpTool[],
  streams: { input: NodeJS.ReadableStream; output: { write(text: string): unknown }; name?: string },
): Promise<void> {
  const lines = createInterface({ input: streams.input, crlfDelay: Infinity });
  const pending = new Set<Promise<void>>();
  for await (const line of lines) {
    if (!line.trim()) continue;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      streams.output.write(
        `${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } })}\n`,
      );
      continue;
    }
    // Answered as they finish: a slow listing does not hold a ping back.
    const answer = handleMcpMessage(message, tools, { name: streams.name ?? 'genaicode-sessions', version: '1' })
      .then((reply) => {
        if (reply !== null) streams.output.write(`${JSON.stringify(reply)}\n`);
      })
      .catch(() => undefined)
      .finally(() => pending.delete(answer));
    pending.add(answer);
  }
  await Promise.all(pending);
}

/** `approval` for a session that asks whether it may use a tool; otherwise its state. */
function stateOf(session: SessionInfo): string | undefined {
  return session.waitingFor === 'approval' ? 'approval' : session.state;
}

function tally(sessions: readonly SessionInfo[]): string {
  const counts = new Map<string, number>();
  for (const session of sessions) {
    const state = stateOf(session);
    if (state) counts.set(state, (counts.get(state) ?? 0) + 1);
  }
  return ['approval', 'active', 'waiting', 'unfinished']
    .filter((state) => counts.has(state))
    .map((state) => `${counts.get(state)} ${state}`)
    .join(', ');
}

function unread(errors: ReadonlyArray<{ source: string; message: string }>): string {
  return errors.length ? `\n(Could not read: ${errors.map((error) => error.source).join(', ')}.)` : '';
}

function positive(value: unknown, fallback: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.min(Math.floor(value) || 1, max)
    : fallback;
}

function lower(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function cut(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function ago(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / (24 * 60))}d`;
}
