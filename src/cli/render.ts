import type { AgentEvent, AgentResult } from '../agents/types.js';

export interface Output {
  write(text: string): unknown;
}

/**
 * Human-readable event printer. Assistant text goes to stdout, so it can be piped;
 * tool calls, edits, and errors go to stderr.
 */
export function createRenderer(stdout: Output, stderr: Output): (event: AgentEvent) => void {
  let streamed = false;
  let midLine = false;
  const text = (value: string) => {
    stdout.write(value);
    midLine = !value.endsWith('\n');
  };
  const note = (line: string) => {
    if (midLine) text('\n');
    stderr.write(`${line}\n`);
  };

  return (event) => {
    switch (event.type) {
      case 'text-delta':
        streamed = true;
        text(event.text);
        break;
      case 'message':
        // Drivers that stream deltas also send the full message; print it only once.
        if (!streamed) text(`${event.text}\n`);
        else if (midLine) text('\n');
        streamed = false;
        break;
      case 'tool-start':
        note(`› ${event.name}${summarize(event.input)}`);
        break;
      case 'tool-end':
        if (event.isError) note(`✗ ${event.name ?? 'tool'} failed`);
        break;
      case 'file-change':
        note(`✎ ${event.paths.join(', ')}`);
        break;
      case 'error':
        note(`error: ${event.message}`);
        break;
      case 'done':
        if (midLine) text('\n');
        break;
      default:
        break;
    }
  };
}

/** One-line result summary for stderr. */
export function describeResult(agent: string, result: AgentResult): string {
  const parts = [`${agent}: ${result.status}`];
  if (result.usage) parts.push(`${result.usage.inputTokens ?? 0} in / ${result.usage.outputTokens ?? 0} out tokens`);
  if (result.costUsd !== undefined) parts.push(`$${result.costUsd.toFixed(4)}`);
  if (result.sessionId) parts.push(`session ${result.sessionId}`);
  const line = parts.join(' · ');
  return result.error ? `${line}\n${result.error}` : line;
}

function summarize(input: unknown): string {
  if (input === undefined || input === null) return '';
  const value =
    typeof input === 'string'
      ? input
      : typeof input === 'object'
        ? (['command', 'cmd', 'file_path', 'path', 'pattern', 'query', 'url']
            .map((key) => (input as Record<string, unknown>)[key])
            .find((field) => typeof field === 'string' || Array.isArray(field)) ?? '')
        : '';
  const flat = (Array.isArray(value) ? value.join(' ') : String(value)).replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  return ` ${flat.length > 80 ? `${flat.slice(0, 79)}…` : flat}`;
}
