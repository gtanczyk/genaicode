import { splitAttached } from '../format.js';
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
let currentDraft: ComposerDraft = { text: '', files: [] };
export function rememberDraft(draft: ComposerDraft) {
  currentDraft = draft;
}
const drafts = new Map<string, ComposerDraft>();
export function savedDraft(): ComposerDraft | undefined {
  const chat = pageChat();
  return chat ? drafts.get(chat) : undefined;
}

export function showChat(id: string) {
  const current = pageChat();
  if (current === id) return;
  if (current) {
    if (currentDraft.text || currentDraft.files.length) drafts.set(current, currentDraft);
    else drafts.delete(current);
  }
  currentDraft = drafts.get(id) ?? { text: '', files: [] };
  history.replaceState(history.state, '', '#chat=' + encodeURIComponent(id));
  window.dispatchEvent(new Event('genaicode-chat'));
}

// A recovered chip already has a server upload. Sending it reuses that upload, including after a restart.
export const uploadedFiles = new WeakMap<File, string>();
const restored = new Map<string, string>();
export function restoreQueued(chat: string, draft: { id: string; prompts: string[] }): ComposerDraft | undefined {
  if (restored.get(chat) === draft.id) return;
  restored.set(chat, draft.id);
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
