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

export function restoreQueued(text: string): ComposerDraft {
  return { text: [text, currentDraft.text].filter(Boolean).join('\n\n'), files: currentDraft.files };
}
