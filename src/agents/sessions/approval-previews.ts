import { isRecord, previewText } from './files.js';
import { isShellTool, shellCommand } from './hook-input.js';
import { transcriptLines } from './transcript.js';
import { inputKey, type LiveRecord } from './live.js';
import type { SessionInfo } from './types.js';

type Command = { tool: string; command: string };

/** Copilot records the decision before an approved command starts executing. */
function copilotCommands(lines: unknown[]): Command[] {
  const open = new Map<string, Command>();
  for (const event of lines) {
    if (!isRecord(event) || !isRecord(event.data) || event.agentId || event.data.parentToolCallId) continue;
    if (event.type === 'assistant.turn_end' || event.type === 'user.message' || event.type === 'session.shutdown')
      open.clear();
    const { requestId, permissionRequest } = event.data;
    if (typeof requestId !== 'string') continue;
    if (event.type === 'permission.completed') open.delete(requestId);
    if (event.type !== 'permission.requested' || !isRecord(permissionRequest) || permissionRequest.kind !== 'shell')
      continue;
    const { shellType, fullCommandText } = permissionRequest;
    if ((shellType === 'bash' || shellType === 'powershell') && typeof fullCommandText === 'string') {
      open.set(requestId, { tool: shellType, command: fullCommandText });
    }
  }
  return [...open.values()];
}

/** Gemini writes scheduled calls before asking, then updates each call by ID. */
function geminiCommands(lines: unknown[]): Command[] {
  const open = new Map<string, Command>();
  for (const message of lines) {
    if (!isRecord(message)) continue;
    if (message.type === 'user') open.clear();
    if (message.type !== 'gemini' || !Array.isArray(message.toolCalls)) continue;
    for (const call of message.toolCalls) {
      if (!isRecord(call) || typeof call.id !== 'string') continue;
      const command = shellCommand('gemini', call.name, call.args);
      if (command && (call.status === 'scheduled' || call.status === 'awaiting_approval')) {
        open.set(call.id, { tool: 'run_shell_command', command });
      } else open.delete(call.id);
    }
  }
  return [...open.values()];
}

/**
 * Recover text from the agent's own journal only for a shell approval the hook still identifies.
 * Genaicode keeps only its existing digest on disk, including on a crash or missed closing hook.
 */
export async function withCommandPreviews(session: SessionInfo, live?: LiveRecord): Promise<SessionInfo> {
  const asks = live?.asks?.filter((ask) => ask?.key && isShellTool(session.source, ask.tool));
  if (
    session.where !== 'local' ||
    session.waitingFor !== 'approval' ||
    !session.path ||
    live?.state !== 'approval' ||
    !asks?.length
  )
    return session;
  try {
    const tail = await transcriptLines(session.path);
    const candidates = session.source === 'gemini' ? geminiCommands(tail) : copilotCommands(tail);
    const pending = [...asks];
    const commands: Command[] = [];
    for (const { tool, command } of candidates) {
      const key = inputKey({ command });
      const index = pending.findIndex((ask) => ask.tool === tool && (ask.commandKey ?? ask.key) === key);
      if (index < 0) continue;
      pending.splice(index, 1);
      const preview = previewText(command);
      if (preview) commands.push({ tool, command: preview });
    }
    return commands.length ? { ...session, waitingCommands: commands } : session;
  } catch {
    return session;
  }
}
