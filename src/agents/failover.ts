import { approximateSize, EventQueue } from './event-queue.js';
import type { AgentEvent, AgentFailure, AgentResult, AgentRun, AgentTask, CodingAgent } from './types.js';

/** Failures another agent can get past: the agent is out, not the task. `budget` is the user's cap. */
const FAILOVER_KINDS: ReadonlySet<AgentFailure['kind']> = new Set(['quota', 'auth', 'unavailable', 'crash']);

/** Whether `result` failed in a way a different agent could get past. */
export function shouldFailOver(result: AgentResult): boolean {
  return result.status === 'failed' && !!result.failure && FAILOVER_KINDS.has(result.failure.kind);
}

/** A line for people: `claude → codex (quota, resets 16:00)`. */
export function describeFailover(from: string, to: string, failure: AgentFailure): string {
  const resets =
    failure.resetsAt !== undefined
      ? `, resets ${new Date(failure.resetsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
      : '';
  return `${from} → ${to} (${failure.kind}${resets})`;
}

/**
 * One `CodingAgent` over several: runs `agents[0]`, and when a run fails with a quota, sign-in,
 * missing CLI or crash (`shouldFailOver`), runs the same task on the next agent. Each agent is
 * tried at most once per run. An agent that failed this way goes last in later runs (until it
 * completes one), so a repair loop does not hit the same limit again. Other failures, a stop and a spent budget end
 * the run as they are.
 *
 * The task goes to the next agent as given, without `resume` (another agent's session id means
 * nothing to it). A `failover` event marks each switch. Capabilities are the first agent's.
 */
export function withFallback(agents: readonly CodingAgent[]): CodingAgent {
  const [first] = agents;
  if (!first) throw new Error('withFallback needs at least one agent.');
  const out = new Set<CodingAgent>();
  return {
    name: first.name,
    command: first.command,
    capabilities: first.capabilities,
    run(task) {
      const events = new EventQueue<AgentEvent>(approximateSize);
      let current: AgentRun | undefined;
      let stopped = false;
      const result = (async (): Promise<AgentResult> => {
        const order = [...agents.filter((agent) => !out.has(agent)), ...agents.filter((agent) => out.has(agent))];
        let next: AgentTask = task;
        for (let i = 0; ; i += 1) {
          const agent = order[i]!;
          const run = agent.run(next);
          current = run;
          if (stopped) run.abort();
          let done: AgentResult | undefined;
          for await (const event of run) {
            if (event.type === 'done') done = event.result;
            else {
              events.push(event);
              await events.room();
            }
          }
          const ended = done ?? (await run.result);
          const to = order[i + 1];
          const isOut = shouldFailOver(ended);
          if (isOut) out.add(agent);
          else if (ended.ok) out.delete(agent);
          if (stopped || !to || !isOut) {
            events.push({ type: 'done', result: ended });
            events.close();
            return ended;
          }
          events.push({ type: 'failover', from: agent.name, to: to.name, failure: ended.failure! });
          next = { ...task, resume: undefined };
        }
      })();
      // Kept for the caller: a driver that throws still ends the run with a result.
      const settled = result.catch((error: unknown): AgentResult => {
        const message = error instanceof Error ? error.message : String(error);
        const failed: AgentResult = { status: 'failed', ok: false, exitCode: null, signal: null, error: message };
        events.push({ type: 'error', message });
        events.push({ type: 'done', result: failed });
        events.close();
        return failed;
      });
      return {
        result: settled,
        abort() {
          stopped = true;
          current?.abort();
        },
        ...(first.capabilities.steer
          ? {
              steer: (text: string) =>
                current?.steer ? current.steer(text) : Promise.reject(new Error('The agent cannot take input now.')),
            }
          : {}),
        [Symbol.asyncIterator]: () => events.iterate(),
      };
    },
  };
}
