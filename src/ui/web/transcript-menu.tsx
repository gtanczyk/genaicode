import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { TranscriptFormat, TranscriptMeta } from '../transcript.js';

export interface TranscriptMenuProps {
  token: string;
  /** Base endpoint: `/api/transcript` or `/api/sessions/<source>/<id>/transcript`. */
  endpoint: string;
  sessionId?: string;
  sessionPath?: string;
  /** Present when exporting a stored session from the Sessions/Chats view. */
  storedSession?: { source: string; id: string };
  /** Desktop host app handles native Save File dialogs via `POST /api/save-transcript`. */
  nativeSave?: boolean;
  label: string;
  ariaLabel?: string;
  title?: string;
  buttonClassName?: string;
  onStatus?(message: string, isError?: boolean): void;
  /** More items at the end of the menu; called with a function that closes it. */
  extra?(close: () => void): ReactNode;
}

/** Synchronous clipboard write with a hidden-textarea fallback when the Clipboard API is unavailable. */
async function copyTextSync(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to execCommand fallback.
    }
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-9999px';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/**
 * Copy text resolved asynchronously while preserving WebKit/WKWebView user activation
 * (`ClipboardItem` accepts a `Promise<Blob>` synchronously inside the click handler).
 */
async function copyTextAsync(load: () => Promise<string>): Promise<boolean> {
  const pending = load();
  if (typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function') {
    let fetchError: unknown;
    const blobPromise = pending.then(
      (text) => new Blob([text], { type: 'text/plain' }),
      (error: unknown) => {
        fetchError = error;
        throw error;
      },
    );
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blobPromise })]);
      return true;
    } catch {
      if (fetchError !== undefined) throw fetchError;
      // Fall back to plain writeText / execCommand (e.g. headless browsers or mocked clipboard).
    }
  }
  const text = await pending;
  return copyTextSync(text);
}

function downloadBlob(text: string, filename: string, mimeType: string) {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Developer/export popover for a conversation or stored session: copy full session ID,
 * raw session file path, Markdown transcript or raw JSON state, and save/download as a file.
 */
export function TranscriptMenu({
  token,
  endpoint,
  sessionId,
  sessionPath,
  storedSession,
  nativeSave,
  label,
  ariaLabel,
  title,
  buttonClassName,
  onStatus,
  extra,
}: TranscriptMenuProps) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState<TranscriptMeta>();
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const effectiveId = sessionId ?? meta?.sessionId;
  const effectivePath = sessionPath ?? meta?.sessionPath;

  useEffect(() => {
    setMeta(undefined);
  }, [endpoint, sessionId]);

  // Refresh metadata (such as resolved session file path on disk) whenever the menu opens.
  useEffect(() => {
    if (!open || sessionPath !== undefined) return;
    const abort = new AbortController();
    fetch(`${endpoint}?format=meta`, {
      headers: { 'x-genaicode-token': token },
      signal: abort.signal,
    })
      .then((res) => (res.ok ? (res.json() as Promise<TranscriptMeta>) : undefined))
      .then((found) => {
        if (!abort.signal.aborted && found) setMeta(found);
      })
      .catch(() => undefined);
    return () => abort.abort();
  }, [open, endpoint, token, sessionPath, sessionId]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  const fetchTranscript = async (format: TranscriptFormat): Promise<{ text: string; filename: string }> => {
    const res = await fetch(`${endpoint}?format=${format}`, {
      headers: { 'x-genaicode-token': token },
    });
    if (!res.ok) {
      const detail = await res
        .json()
        .then((body: { error?: unknown }) => (typeof body?.error === 'string' ? body.error : undefined))
        .catch(() => undefined);
      throw new Error(detail ?? `Server answered ${res.status}.`);
    }
    const filename = res.headers.get('x-genaicode-filename') || `genaicode-transcript.${format}`;
    return { text: await res.text(), filename };
  };

  const report = (message: string, isError = false) => onStatus?.(message, isError);

  const copyId = () => {
    if (!effectiveId) return;
    setOpen(false);
    void copyTextSync(effectiveId).then((ok) => {
      if (ok) report('Copied session ID');
      else window.prompt('Session ID:', effectiveId);
    });
  };

  const copyPath = () => {
    setOpen(false);
    if (effectivePath) {
      void copyTextSync(effectivePath).then((ok) => {
        if (ok) report('Copied session file path');
        else window.prompt('Session file path:', effectivePath);
      });
      return;
    }
    setBusy(true);
    void copyTextAsync(async () => {
      const res = await fetch(`${endpoint}?format=meta`, { headers: { 'x-genaicode-token': token } });
      if (!res.ok) throw new Error(`Server answered ${res.status}.`);
      const found = (await res.json()) as TranscriptMeta;
      setMeta(found);
      if (!found.sessionPath) throw new Error('No session file found on disk yet.');
      return found.sessionPath;
    })
      .then((ok) => report(ok ? 'Copied session file path' : 'Could not copy session file path', !ok))
      .catch((error: unknown) => report(error instanceof Error ? error.message : 'Could not read session path.', true))
      .finally(() => setBusy(false));
  };

  const copyTranscript = (format: TranscriptFormat) => {
    setOpen(false);
    setBusy(true);
    const what = format === 'md' ? 'transcript (Markdown)' : storedSession ? 'transcript (JSON)' : 'raw state (JSON)';
    void copyTextAsync(async () => (await fetchTranscript(format)).text)
      .then((ok) => report(ok ? `Copied ${what}` : `Could not copy ${what}`, !ok))
      .catch((error: unknown) => report(error instanceof Error ? error.message : `Could not load ${what}.`, true))
      .finally(() => setBusy(false));
  };

  const saveTranscript = (format: TranscriptFormat) => {
    setOpen(false);
    if (nativeSave) {
      setBusy(true);
      void fetch('/api/save-transcript', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-genaicode-token': token },
        body: JSON.stringify({ format, ...(storedSession ?? {}) }),
      })
        .then((res) => {
          if (!res.ok) report(`Could not open Save dialog (${res.status}).`, true);
        })
        .catch(() => report('Could not reach genaicode.', true))
        .finally(() => setBusy(false));
      return;
    }
    setBusy(true);
    void fetchTranscript(format)
      .then(({ text, filename }) => {
        downloadBlob(
          text,
          filename,
          format === 'json' ? 'application/json;charset=utf-8' : 'text/markdown;charset=utf-8',
        );
        report(`Downloaded ${filename}`);
      })
      .catch((error: unknown) =>
        report(error instanceof Error ? error.message : 'Could not download transcript.', true),
      )
      .finally(() => setBusy(false));
  };

  const toggle = () => {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setUp(rect.bottom + 280 > window.innerHeight && rect.top > 280);
    }
    setOpen((value) => !value);
  };

  return (
    <div className="tm-wrap" ref={wrapRef} data-tauri-drag-region="false">
      <button
        ref={buttonRef}
        type="button"
        className={buttonClassName}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        title={title}
        disabled={busy}
        onClick={toggle}
      >
        {label}
      </button>
      {open ? (
        <div
          className={`tm-popover${up ? ' tm-up' : ''}`}
          role="menu"
          aria-label="Conversation transcript and developer actions"
          onMouseDown={(event) => event.stopPropagation()}
        >
          {effectiveId || effectivePath ? (
            <div className="tm-head">
              {effectiveId ? (
                <div className="tm-meta" title={effectiveId}>
                  <span>ID</span>
                  <code>{effectiveId}</code>
                </div>
              ) : null}
              {effectivePath ? (
                <div className="tm-meta" title={effectivePath}>
                  <span>File</span>
                  <code>{effectivePath}</code>
                </div>
              ) : null}
            </div>
          ) : null}
          {effectiveId ? (
            <button type="button" role="menuitem" onClick={copyId}>
              Copy session ID
            </button>
          ) : null}
          {effectivePath || (!storedSession && effectiveId) ? (
            <button type="button" role="menuitem" onClick={copyPath}>
              Copy session file path
            </button>
          ) : null}
          {effectiveId || effectivePath ? <hr /> : null}
          <button type="button" role="menuitem" onClick={() => copyTranscript('md')}>
            Copy transcript (Markdown)
          </button>
          <button type="button" role="menuitem" onClick={() => copyTranscript('json')}>
            {storedSession ? 'Copy transcript (JSON)' : 'Copy raw state (JSON)'}
          </button>
          <hr />
          <button type="button" role="menuitem" onClick={() => saveTranscript('md')}>
            {nativeSave ? 'Save Markdown…' : 'Download Markdown (.md)'}
          </button>
          <button type="button" role="menuitem" onClick={() => saveTranscript('json')}>
            {nativeSave ? 'Save JSON…' : 'Download JSON (.json)'}
          </button>
          {extra?.(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}
