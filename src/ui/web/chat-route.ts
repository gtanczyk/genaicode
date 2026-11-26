import type { SessionState } from '../../agents/session.js';
import { parseShell, parseSlash, splitAttached } from '../format.js';
/** Each page keeps the chat it opened, including while its uploads or dialogs are pending. */
export function pageChat(): string | undefined {
  return new URLSearchParams(location.hash.slice(1)).get('chat') ?? undefined;
}

export function chatUrl(path: string, chat = pageChat()): string {
  if (!chat) return path;
  const url = new URL(path, location.origin);
  url.searchParams.set('chat', chat);
  return url.pathname + url.search;
}

export function chatFetch(path: string, init?: RequestInit) {
  return fetch(chatUrl(path), init);
}

export interface ComposerDraft {
  text: string;
  files: File[];
}
const drafts = new Map<string, ComposerDraft>();
export function rememberDraft(chat: string, draft: ComposerDraft) {
  if (draft.text || draft.files.length) drafts.set(chat, draft);
  else drafts.delete(chat);
}
export function savedDraft(chat?: string): ComposerDraft | undefined {
  return chat ? drafts.get(chat) : undefined;
}

/** Recover editable prompt text when opening a chat that already has a transcript. */
export function transcriptInputs(session?: SessionState): string[] {
  if (!session) return [];
  const inputs = session.turns.flatMap((turn) => [
    turn.prompt,
    ...turn.entries.flatMap((entry) => (entry.kind === 'input' ? [entry.text] : [])),
  ]);
  return [...inputs, ...session.queued]
    .map((input) => {
      const { text } = splitAttached(input);
      // A literal prefix in a delivered prompt has already lost its escape.
      const trimmed = text.trimStart();
      if (trimmed.startsWith('!') || trimmed.startsWith('/')) return trimmed[0] + trimmed;
      return text;
    })
    .filter(Boolean);
}

/** Keep the text as typed, including commands and prompts still uploading, alongside other clients' inputs. */
export interface ComposerInput {
  text: string;
  /** Number of transcript inputs visible at submission. */
  after: number;
}

export function composerHistory(transcript: readonly string[], local: readonly ComposerInput[]): string[] {
  const history: string[] = [];
  let index = 0;
  for (const { text, after } of local) {
    const boundary = Math.min(after, transcript.length);
    while (index < boundary) history.push(transcript[index++]);
    // Prompts appear in the transcript when delivered, possibly after messages from another client.
    // Host commands have no prompt bubble. Their position stays where the user submitted them.
    if (parseShell(text) === undefined && !parseSlash(text)) {
      const submitted = text.trim();
      let echo = index;
      while (echo < transcript.length && transcript[echo].trim() !== submitted) echo++;
      if (echo < transcript.length) {
        while (index < echo) history.push(transcript[index++]);
        index++;
      }
    }
    history.push(text);
  }
  while (index < transcript.length) history.push(transcript[index++]);
  return history.filter((text, i) => text !== history[i - 1]).slice(-100);
}

export function showChat(id: string) {
  if (pageChat() === id) return;
  history.replaceState(history.state, '', '#chat=' + encodeURIComponent(id));
  window.dispatchEvent(new Event('genaicode-chat'));
}

// A recovered chip already has a server upload. Sending it reuses that upload, including after a restart.
export const uploadedFiles = new WeakMap<File, string>();
const restored = new Map<string, string>();
export function restoreQueued(chat: string, draft: { id: string; prompts: string[] }): ComposerDraft | undefined {
  if (restored.get(chat) === draft.id) return;
  restored.set(chat, draft.id);
  const currentDraft = savedDraft(chat) ?? { text: '', files: [] };
  const parts = draft.prompts.map(splitAttached);
  const files = [...currentDraft.files];
  const text = parts.map((p) => p.text);
  for (const attachment of parts.flatMap((p) => p.files)) {
    if (!attachment.id) {
      text.push(attachment.path);
      continue;
    }
    if (files.some((f) => uploadedFiles.get(f) === attachment.id)) continue;
    const file = new File([], attachment.name);
    uploadedFiles.set(file, attachment.id);
    files.push(file);
  }
  return { text: [...text, currentDraft.text].filter(Boolean).join('\n\n'), files };
}
