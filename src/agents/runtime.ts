import { existsSync, statSync } from 'node:fs';
import { approximateSize, EventQueue } from './event-queue.js';
import type { ProcessExit } from './process.js';
import type { AgentEvent, AgentResult } from './types.js';

const STDERR_TAIL_BYTES = 4 * 1024;

/** What a driver reports about the task's end, beyond the exit code. */
export interface AgentOutcome {
  ok: boolean;
  error?: string;
}

/** Collects events for iteration and folds them into the pieces of an `AgentResult`. */
export class RunRecorder {
  readonly events = new EventQueue<AgentEvent>(approximateSize);
  private sessionId?: string;
  private text?: string;
  private usage?: AgentResult['usage'];
  private costUsd?: number;
  private lastError?: string;
  private stderrTail = '';

  constructor(
    private readonly name: string,
    private readonly command: string,
  ) {}

  emit(event: AgentEvent): void {
    if (event.type === 'session') this.sessionId = event.sessionId;
    if (event.type === 'message') this.text = event.text;
    if (event.type === 'usage') {
      this.usage = event.usage;
      if (event.costUsd !== undefined) this.costUsd = event.costUsd;
    }
    if (event.type === 'error') this.lastError = event.message;
    if (event.type === 'stderr') this.stderrTail = (this.stderrTail + event.text).slice(-STDERR_TAIL_BYTES);
    this.events.push(event);
  }

  /** Build the result, emit `done`, and end the event stream. */
  finish(exit: ProcessExit, outcome: AgentOutcome | undefined): AgentResult {
    const status = statusOf(exit, outcome);
    const error = status === 'completed' ? undefined : this.errorOf(status, exit, outcome);
    const result: AgentResult = {
      status,
      ok: status === 'completed',
      exitCode: exit.exitCode,
      signal: exit.signal,
      ...(this.sessionId ? { sessionId: this.sessionId } : {}),
      ...(this.text !== undefined ? { text: this.text } : {}),
      ...(this.usage ? { usage: this.usage } : {}),
      ...(this.costUsd !== undefined ? { costUsd: this.costUsd } : {}),
      ...(error ? { error } : {}),
    };
    this.events.push({ type: 'done', result });
    this.events.close();
    return result;
  }

  private errorOf(status: AgentResult['status'], exit: ProcessExit, outcome: AgentOutcome | undefined): string {
    if (status === 'aborted') return `${this.name} was stopped.`;
    if (status === 'timeout') return `${this.name} timed out.`;
    if (exit.reason === 'overflow') return `${this.name} wrote a stdout line over 16 MiB.`;
    if (exit.reason === 'spawn-error') return spawnMessage(this.name, this.command, exit.error);
    const reported = outcome?.ok === false ? outcome.error : undefined;
    if (reported ?? this.lastError) return (reported ?? this.lastError)!;
    if (exit.reason === 'closed') return `${this.name} ended without reporting a result.`;
    return this.stderrTail.trim() || `${this.name} exited with code ${exit.exitCode ?? 'unknown'}.`;
  }
}

function statusOf(exit: ProcessExit, outcome: AgentOutcome | undefined): AgentResult['status'] {
  switch (exit.reason) {
    case 'aborted':
      return 'aborted';
    case 'timeout':
      return 'timeout';
    case 'closed':
      return outcome?.ok === true ? 'completed' : 'failed';
    case 'exit':
      return exit.exitCode === 0 && outcome?.ok !== false ? 'completed' : 'failed';
    default:
      return 'failed';
  }
}

export function invalidCwd(cwd: string): string | undefined {
  if (!existsSync(cwd)) return `Working directory does not exist: ${cwd}`;
  if (!statSync(cwd).isDirectory()) return `Working directory is not a directory: ${cwd}`;
  return undefined;
}

function spawnMessage(name: string, command: string, error: Error | undefined): string {
  if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT')
    return `${command} was not found. Install ${name} or pass its path as \`command\`.`;
  return error?.message ?? `${name} could not start.`;
}
