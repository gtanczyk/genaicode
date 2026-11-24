import { approximateSize, EventQueue } from './event-queue.js';
import { addUsage, tokenCount } from './usage.js';
import { callerGaveServers, isSessionChannel } from './session-channels.js';
import type {
  AgentBudget,
  AgentEvent,
  AgentFailure,
  AgentMode,
  AgentResult,
  AgentRun,
  AgentTask,
  CodingAgent,
} from './types.js';

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

/** What an agent that can describe itself says (`remote()` and `nano()` in `genaicode/browser`). */
export interface AgentInfo {
  available: boolean;
  /** Media the agent takes besides text, such as `image` or `audio`. */
  inputs?: readonly string[];
  /** When an agent that is out (over its allowance) is back, epoch ms. */
  resetsAt?: number;
}

interface Describable {
  info?(signal?: AbortSignal): Promise<AgentInfo>;
  forget?(sessionId?: string): void;
}

/**
 * The session adds its channels (progress, `ask_user`) by the first agent's capabilities: a backup
 * that is remote or has no MCP gets none of them. Only the channels go: other servers stay, and a
 * list that held nothing else goes back to what the caller gave: `[]`, or no list at all.
 */
function withoutChannels(agent: CodingAgent, task: AgentTask): AgentTask {
  const servers = task.mcpServers;
  if (!servers?.some(isSessionChannel) || (agent.capabilities.mcp && !agent.capabilities.remote)) return task;
  const kept = servers.filter((server) => !isSessionChannel(server));
  const rest = { ...task };
  delete rest.mcpServers;
  return kept.length || callerGaveServers(servers) ? { ...rest, mcpServers: kept } : rest;
}

/**
 * One `CodingAgent` over several: runs `agents[0]`, and when a run fails with a quota, sign-in,
 * missing CLI or crash (`shouldFailOver`), runs the same task on the next agent. Each agent is
 * tried at most once per run. An agent that failed this way goes last in later runs (until it
 * completes one), so a repair loop does not hit the same limit again. Other failures, a stop and a spent budget end
 * the run as they are.
 *
 * Each agent gets `model` only if it is the first one and `resume` only if the session is its own
 * (another vendor's ids mean nothing to it), `effort` only where it takes it, and `budget` minus what earlier agents used.
 * The result adds up every agent's usage and cost. A `failover` event marks each switch. Capabilities are the first agent's.
 *
 * Where an agent has `info()`, so does the result: available when any agent is, with the inputs of
 * the first available one, and an agent without `info()` counts as available. Runs after it start
 * with that agent: one that said it is not available is tried after the others.
 * `forget()` reaches every agent that has it.
 */
export function withFallback(agents: readonly CodingAgent[]): CodingAgent & Describable {
  const [first] = agents;
  if (!first) throw new Error('withFallback needs at least one agent.');
  const out = new Set<CodingAgent>();
  // Agents whose last info() said they are not available: runs try them after the rest, even
  // after one that failed earlier but says it is available now.
  const down = new Set<CodingAgent>();
  // Agents info() could not ask: after the ones that said they are available, before `down`.
  const unasked = new Set<CodingAgent>();
  const ordered = () => {
    const rank = (agent: CodingAgent) => (down.has(agent) ? 4 : unasked.has(agent) ? 2 : 0) + (out.has(agent) ? 1 : 0);
    return [...agents].sort((a, b) => rank(a) - rank(b));
  };
  // The agent whose session the last result named: a `resume` id is only its.
  let sessionOwner: CodingAgent | undefined;
  // Effective mode of known sessions, so a resumed Plan turn stays Plan even if its owner fails before init.
  const sessionModes = new Map<string, AgentMode>();
  const rememberMode = (id: string, mode: AgentMode) => {
    if (sessionModes.size >= 256) sessionModes.clear();
    sessionModes.set(id, mode);
  };
  /** `task` as `agent` can take it: vendor ids only for the agent they belong to. */
  const taskFor = (
    agent: CodingAgent,
    task: AgentTask,
    budget: AgentBudget | undefined,
    mode: AgentMode | undefined,
  ): AgentTask => {
    const own = agent === (sessionOwner ?? first);
    return {
      ...(agent === first ? task : withoutChannels(agent, task)),
      ...(mode !== undefined ? { mode } : {}),
      ...(own ? {} : { resume: undefined }),
      ...(agent === first ? {} : { model: undefined }),
      ...(agent !== first && task.effort !== undefined && !agent.capabilities.effort?.includes(task.effort)
        ? { effort: undefined }
        : {}),
      ...(budget ? { budget } : {}),
    };
  };
  const described = agents as readonly (CodingAgent & Describable)[];
  const extra: Describable = {};
  if (described.some((agent) => agent.info)) {
    extra.info = async (signal) => {
      const answers = await Promise.all(
        described.map(async (agent): Promise<AgentInfo | Error> => {
          if (!agent.info) return { available: true };
          try {
            return await agent.info(signal);
          } catch (error) {
            return error instanceof Error ? error : new Error(String(error));
          }
        }),
      );
      down.clear();
      unasked.clear();
      answers.forEach((answer, i) => {
        if (answer instanceof Error) unasked.add(described[i]!);
        else if (!answer.available) down.add(described[i]!);
      });
      // The inputs of the agent a run starts with.
      for (const agent of ordered()) {
        const answer = answers[described.indexOf(agent as CodingAgent & Describable)]!;
        if (!(answer instanceof Error) && answer.available) {
          return { available: true, ...(answer.inputs ? { inputs: answer.inputs } : {}) };
        }
      }
      // None says it is available; one that could not be asked may still be.
      const unknown = answers.find((answer): answer is Error => answer instanceof Error);
      if (unknown) throw unknown;
      const resets = (answers as AgentInfo[]).flatMap((answer) =>
        answer.resetsAt !== undefined ? [answer.resetsAt] : [],
      );
      return { available: false, ...(resets.length ? { resetsAt: Math.min(...resets) } : {}) };
    };
  }
  if (described.some((agent) => agent.forget)) {
    extra.forget = (sessionId) => {
      for (const agent of described) agent.forget?.(sessionId);
    };
  }
  return {
    ...extra,
    name: first.name,
    command: first.command,
    capabilities: first.capabilities,
    run(task) {
      const events = new EventQueue<AgentEvent>(approximateSize);
      let current: AgentRun | undefined;
      let stopped = false;
      const result = (async (): Promise<AgentResult> => {
        let effectiveMode: AgentMode | undefined =
          task.mode ?? (task.resume !== undefined ? sessionModes.get(task.resume) : undefined);
        const all = ordered();
        const order = effectiveMode === 'plan' ? all.filter((agent) => agent.capabilities.plan) : all;
        if (!order.length) {
          const message = `${first.name} does not support Plan mode in this driver.`;
          const failed: AgentResult = { status: 'failed', ok: false, exitCode: null, signal: null, error: message };
          events.push({ type: 'error', message });
          events.push({ type: 'done', result: failed });
          events.close();
          return failed;
        }
        let budget = task.budget;
        let usage: AgentResult['usage'];
        let costUsd: number | undefined;
        for (let i = 0; ; ) {
          const agent = order[i]!;
          const run = agent.run(taskFor(agent, task, budget, effectiveMode));
          current = run;
          if (stopped) run.abort();
          let done: AgentResult | undefined;
          let runSessionId: string | undefined;
          // Usage events are running totals for the run: earlier agents' share goes on top.
          const priorUsage = usage;
          const priorCost = costUsd;
          for await (const event of run) {
            if (event.type === 'done') done = event.result;
            else {
              if (event.type === 'session') {
                runSessionId = event.sessionId;
                if (event.mode === 'plan') effectiveMode = 'plan';
                if (effectiveMode !== undefined) rememberMode(event.sessionId, effectiveMode);
              }
              events.push(
                event.type === 'usage' && (priorUsage || priorCost !== undefined)
                  ? {
                      ...event,
                      usage: priorUsage ? addUsage(priorUsage, event.usage) : event.usage,
                      ...(event.costUsd !== undefined || priorCost !== undefined
                        ? { costUsd: (priorCost ?? 0) + (event.costUsd ?? 0) }
                        : {}),
                    }
                  : event,
              );
              await events.room();
            }
          }
          const own = done ?? (await run.result);
          if (own.usage) usage = usage ? addUsage(usage, own.usage) : own.usage;
          if (own.costUsd !== undefined) costUsd = (costUsd ?? 0) + own.costUsd;
          if (own.sessionId) sessionOwner = agent;
          const sid = own.sessionId ?? runSessionId ?? (own.ok ? task.resume : undefined);
          if (sid && effectiveMode !== undefined) rememberMode(sid, effectiveMode);
          const ended: AgentResult = {
            ...own,
            ...(usage ? { usage } : {}),
            ...(costUsd !== undefined ? { costUsd } : {}),
          };
          const left = leftOf(task.budget, usage, costUsd);
          let nextIndex = i + 1;
          while (nextIndex < order.length && effectiveMode === 'plan' && !order[nextIndex]!.capabilities.plan) {
            nextIndex += 1;
          }
          const to = order[nextIndex];
          const isOut = shouldFailOver(ended);
          if (isOut) out.add(agent);
          else if (ended.ok) {
            out.delete(agent);
            down.delete(agent);
            unasked.delete(agent);
          }
          if (stopped || !to || !isOut || left === 'spent') {
            events.push({ type: 'done', result: ended });
            events.close();
            return ended;
          }
          events.push({ type: 'failover', from: agent.name, to: to.name, failure: ended.failure! });
          if (left) budget = left;
          i = nextIndex;
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

/** `budget` minus what was used so far, or `spent` when a cap has nothing left. */
function leftOf(
  budget: AgentBudget | undefined,
  usage: AgentResult['usage'],
  costUsd: number | undefined,
): AgentBudget | 'spent' | undefined {
  if (!budget) return undefined;
  const next: AgentBudget = { ...budget };
  if (budget.maxTokens !== undefined) next.maxTokens = budget.maxTokens - (usage ? tokenCount(usage) : 0);
  if (budget.maxCostUsd !== undefined) next.maxCostUsd = budget.maxCostUsd - (costUsd ?? 0);
  if ((next.maxTokens ?? 1) <= 0 || (next.maxCostUsd ?? 1) <= 0) return 'spent';
  return next;
}
