import { useEffect, useState } from 'react';
import { Markdown } from '../../react/markdown.js';
import type { SessionInfo } from '../../agents/sessions/types.js';

export function transcriptUrl({ source, id }: SessionInfo) {
  return `/api/sessions/${encodeURIComponent(source)}/${encodeURIComponent(id)}/transcript`;
}

export function SessionTranscript({
  session,
  token,
  revision,
}: {
  session: SessionInfo;
  token: string;
  revision: number;
}) {
  const [text, setText] = useState<string>();
  const [error, setError] = useState<string>();
  const url = transcriptUrl(session);
  useEffect(() => {
    const controller = new AbortController();
    fetch(url + '?format=view', { signal: controller.signal, headers: { 'x-genaicode-token': token } })
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error ?? `The server answered ${res.status}.`);
        return res.text();
      })
      .then((body) => {
        if (!controller.signal.aborted) {
          setText(body);
          setError(undefined);
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => controller.abort();
  }, [url, token, revision]);
  if (error) return <p role="alert">Could not read this session: {error}</p>;
  return text === undefined ? <p role="status">Reading transcript…</p> : <Markdown text={text} />;
}
