import { useEffect, useState } from 'react';
import { formatBytes } from '../../react/format.js';
import type { FileView } from '../files.js';

const PROBLEMS: Record<string, string> = {
  outside: 'This file is outside the project, so it is not shown here.',
  binary: 'This is not a text file.',
  missing: 'This file is not there (it may have been moved or deleted).',
};

/** A project file beside the chat, as it is on disk now. Esc or the button closes it. */
export function FilePanel({ path, token, onClose }: { path: string; token: string; onClose(): void }) {
  const [file, setFile] = useState<FileView>();
  const [problem, setProblem] = useState<string>();
  useEffect(() => {
    const abort = new AbortController();
    setFile(undefined);
    setProblem(undefined);
    fetch(`/api/file?path=${encodeURIComponent(path)}`, {
      headers: { 'x-genaicode-token': token },
      signal: abort.signal,
    })
      .then(async (res) => {
        const body = (await res.json()) as FileView & { error?: string };
        if (res.ok) setFile(body);
        else setProblem(PROBLEMS[body.error ?? ''] ?? 'The file could not be read.');
      })
      .catch(() => {
        if (!abort.signal.aborted) setProblem('The file could not be read.');
      });
    return () => abort.abort();
  }, [path, token]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Esc closes the file first; the chat's own Esc (stop the agent) is for the next press.
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  const lines = file ? file.text.replace(/\n$/, '').split('\n') : [];
  return (
    <aside className="file-panel" aria-label={`File ${file?.path ?? path}`}>
      <header>
        <code title={path}>{file?.path ?? path}</code>
        {file ? <small>{formatBytes(file.size)}</small> : null}
        <span className="spacer" />
        <button className="chip" onClick={onClose} title="Close (Esc)">
          Close
        </button>
      </header>
      {problem ? (
        <p className="file-problem">{problem}</p>
      ) : file ? (
        <>
          <pre className="file-text">
            {lines.map((line, index) => (
              <span key={index}>{line || ' '}</span>
            ))}
          </pre>
          {file.truncated ? <p className="file-problem">The file is longer; this is its start.</p> : null}
        </>
      ) : (
        <p className="file-problem">Reading…</p>
      )}
    </aside>
  );
}
