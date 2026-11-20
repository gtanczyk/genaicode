import { isAbsolute } from 'node:path';
import { unsupportedTask } from '../prepare.js';
import { invalidCwd } from '../runtime.js';
import type { AgentEvent, AgentResult, AgentTask, CodingAgent } from '../types.js';
import { acceptsSessionPrompt } from './group.js';
import { agentSessionSources, findSession } from './index.js';
import { sessionWithLive } from './live.js';
import { claimSession } from './send-lock.js';
import type { SessionInfo } from './types.js';

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
  if (!id.trim() || !prompt.trim()) throw new Error('A session id and a nonempty prompt are required.');
  const { source, env, signal, permissions, onEvent } = options;
  const local = agents.filter((agent) => agent.sessions?.where === 'local');
  const sources = agentSessionSources(local);
  const query = { env, signal };
  signal?.throwIfAborted();
  // The browser already supplies the full key. Resolve a CLI prefix before choosing the lock.
  const target = source === undefined ? (await findSession(sources, id, query))?.session : { source, id };
  const store = sources.find((s) => s.name === target?.source);
  if (!target || !store) throw new Error(`No local session "${id}" found.`);
  const release = claimSession(store.name, target.id, env);
  try {
    // Re-read the exact row inside the claim: the earlier listing may already be out of date.
    const fresh = (await findSession([store], target.id, query))?.session;
    if (!fresh || fresh.id !== target.id || fresh.where !== 'local') throw new Error(`No local session "${id}" found.`);
    const session = await sessionWithLive(fresh, env);
    if (!session.cwd || !isAbsolute(session.cwd)) throw new Error('This session has no absolute working directory.');
    if (fresh.waitingFor === 'approval' || session.waitingFor === 'approval')
      throw new Error('The session is waiting for an approval.');
    if (!acceptsSessionPrompt(session)) throw new Error('Only waiting or unfinished sessions can receive a prompt.');
    const agent = local.find(
      (a) => a.name === session.agent && a.sessions?.name === store.name && a.capabilities.resume,
    );
    if (!agent) throw new Error(`No driver can resume this ${session.agent} session.`);
    const task: AgentTask = { cwd: session.cwd, resume: session.id, prompt, env, signal, permissions };
    const refused = unsupportedTask(agent.name, agent.capabilities, task) ?? invalidCwd(task.cwd);
    if (refused) throw new Error(refused);
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
