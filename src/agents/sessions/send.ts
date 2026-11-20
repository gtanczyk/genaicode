import { isAbsolute } from 'node:path';
import { unsupportedTask } from '../prepare.js';
import { invalidCwd } from '../runtime.js';
import type { AgentEvent, AgentResult, AgentTask, CodingAgent } from '../types.js';
import { acceptsSessionPrompt } from './group.js';
import { agentSessionSources, findSession } from './index.js';
import { sessionWithLive } from './live.js';
import { claimSession } from './send-lock.js';
import type { SessionInfo } from './types.js';

const refusals = {
  prompt: 'A session id and a nonempty prompt are required.',
  missing: 'This local session could not be found.',
  busy: 'A prompt is already running in this session.',
  directory: 'The original working directory is unavailable.',
  approval: 'The session is waiting for an approval.',
  state: 'Only waiting or unfinished sessions can receive a prompt.',
  driver: 'The original agent cannot resume this session.',
  permissions: 'The original agent cannot use the selected permissions.',
};

/** A refused send has a public explanation. Local drivers and filesystem exceptions may carry diagnostics. */
export class SessionSendError extends Error {
  constructor(
    readonly reason: keyof typeof refusals,
    detail?: string,
  ) {
    super(detail ?? refusals[reason]);
  }

  get publicMessage(): string {
    return refusals[this.reason];
  }
}

export interface SessionSendOptions extends Pick<AgentTask, 'env' | 'permissions' | 'signal'> {
  /** Target an exact (source, id) pair. Without a source, a unique id prefix is enough. */
  source?: string;
  onEvent?(event: AgentEvent, session: SessionInfo): void;
}

/** Send one human-requested turn to a local session through its own resumable driver. */
export async function sendSession(
  agents: readonly CodingAgent[],
  id: string,
  prompt: string,
  options: SessionSendOptions = {},
): Promise<AgentResult> {
  if (!id.trim() || !prompt.trim()) throw new SessionSendError('prompt');
  const { source, env, signal, permissions, onEvent } = options;
  const local = agents.filter((agent) => agent.sessions?.where === 'local');
  const sources = agentSessionSources(local);
  const query = { env, signal };
  signal?.throwIfAborted();
  // The browser already supplies the full key. Resolve a CLI prefix before choosing the lock.
  const target = source === undefined ? (await findSession(sources, id, query))?.session : { source, id };
  const store = sources.find((s) => s.name === target?.source);
  if (!target || !store) throw new SessionSendError('missing', `No local session "${id}" found.`);
  const release = claimSession(store.name, target.id, env);
  if (!release) throw new SessionSendError('busy');
  try {
    // Re-read the exact row inside the claim: the earlier listing may already be out of date.
    const fresh = (await findSession([store], target.id, query))?.session;
    if (!fresh || fresh.id !== target.id || fresh.where !== 'local')
      throw new SessionSendError('missing', `No local session "${id}" found.`);
    const session = await sessionWithLive(fresh, env);
    if (!session.cwd || !isAbsolute(session.cwd))
      throw new SessionSendError('directory', 'This session has no absolute working directory.');
    if (fresh.waitingFor === 'approval' || session.waitingFor === 'approval') throw new SessionSendError('approval');
    if (!acceptsSessionPrompt(session)) throw new SessionSendError('state');
    const agent = local.find(
      (a) => a.name === session.agent && a.sessions?.name === store.name && a.capabilities.resume,
    );
    if (!agent) throw new SessionSendError('driver', `No driver can resume this ${session.agent} session.`);
    const task: AgentTask = { cwd: session.cwd, resume: session.id, prompt, env, signal, permissions };
    const refused = unsupportedTask(agent.name, agent.capabilities, task);
    if (refused) throw new SessionSendError('permissions', refused);
    const cwdError = invalidCwd(task.cwd);
    if (cwdError) throw new SessionSendError('directory', cwdError);
    signal?.throwIfAborted();
    const run = agent.run(task);
    try {
      if (onEvent) {
        for await (const event of run) onEvent(event, session);
      }
      return await run.result;
    } catch (error) {
      run.abort();
      await run.result.catch(() => undefined);
      throw error;
    }
  } finally {
    release();
  }
}
