import { useCallback, useEffect, useRef, useState } from 'react';
import type { TurnAttachment } from '../agents/session.js';
import { formatBytes } from './format.js';

/** What the composer lets the user attach. */
export interface ChatAttachments {
  /**
   * What files are taken, as in `<input accept>`: MIME types, `image/*`, extensions. A file
   * that does not match is not added. Default: anything.
   */
  accept?: string;
  /** Offer a microphone button that records a voice message as an audio file. Default false. */
  voice?: boolean;
  /** Most files on one prompt. Default 4. */
  max?: number;
}

/** Whether `file` matches an `<input accept>` list. An empty list takes everything. */
export function matchesAccept(file: { name: string; type: string }, accept: string | undefined): boolean {
  const rules = (accept ?? '')
    .split(',')
    .map((rule) => rule.trim().toLowerCase())
    .filter(Boolean);
  if (!rules.length) return true;
  const name = file.name.toLowerCase();
  // `audio/webm;codecs=opus` is `audio/webm`.
  const type = file.type.toLowerCase().split(';')[0].trim();
  return rules.some((rule) =>
    rule.startsWith('.')
      ? name.endsWith(rule)
      : rule.endsWith('/*')
        ? type.startsWith(rule.slice(0, -1))
        : type === rule,
  );
}

type Recorder = { stop(): void; state: string };

/** The files waiting in the composer, and the voice recorder that adds to them. */
export function useAttachments(options: ChatAttachments | undefined) {
  const [files, setFiles] = useState<File[]>([]);
  const [recording, setRecording] = useState(false);
  const [problem, setProblem] = useState<string>();
  const recorder = useRef<Recorder | undefined>(undefined);
  const asking = useRef(false);
  const gone = useRef(false);
  const max = options?.max ?? 4;
  const accept = options?.accept;
  const enabled = options !== undefined;

  const add = useCallback(
    (incoming: ArrayLike<File>) => {
      if (!enabled) return;
      const list = Array.from(incoming);
      const taken = list.filter((file) => matchesAccept(file, accept));
      setFiles((current) => [...current, ...taken].slice(0, max));
      setProblem(
        taken.length < list.length
          ? `Not attached: ${list
              .filter((file) => !taken.includes(file))
              .map((file) => file.name || 'a file')
              .join(', ')} (not a kind this chat takes).`
          : undefined,
      );
    },
    [accept, enabled, max],
  );
  const remove = useCallback((index: number) => setFiles((current) => current.filter((_, at) => at !== index)), []);
  const clear = useCallback(() => {
    setFiles([]);
    setProblem(undefined);
  }, []);
  // A composer that stops taking files must not send ones the user can no longer see or take off.
  useEffect(() => {
    if (!enabled) clear();
  }, [enabled, clear]);

  const canRecord =
    !!options?.voice &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined';

  const toggleRecording = useCallback(async () => {
    if (recorder.current) {
      recorder.current.stop();
      return;
    }
    if (asking.current) return;
    asking.current = true;
    let stream: MediaStream | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true }).finally(() => {
        asking.current = false;
      });
      // The composer or its record button went away while the browser asked: nobody could stop this.
      if (gone.current || !voice.current) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      const taken = stream;
      const chunks: Blob[] = [];
      const media = new MediaRecorder(taken);
      media.addEventListener('dataavailable', (event) => {
        if (event.data.size) chunks.push(event.data);
      });
      media.addEventListener('stop', () => {
        for (const track of taken.getTracks()) track.stop();
        recorder.current = undefined;
        if (gone.current) return;
        setRecording(false);
        const type = media.mimeType || 'audio/webm';
        const extension = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
        if (chunks.length) add([new File(chunks, `voice-message.${extension}`, { type })]);
      });
      recorder.current = media;
      media.start();
      setRecording(true);
      setProblem(undefined);
    } catch (error) {
      // A recorder that would not start must not leave the microphone on.
      for (const track of stream?.getTracks() ?? []) track.stop();
      recorder.current = undefined;
      setRecording(false);
      setProblem(
        `The microphone is not available${error instanceof Error && error.message ? `: ${error.message}` : '.'}`,
      );
    }
  }, [add]);

  // Without voice messages there is no button to stop a recording with.
  const voice = useRef(canRecord);
  voice.current = canRecord;
  useEffect(() => {
    if (!canRecord && recorder.current && recorder.current.state !== 'inactive') recorder.current.stop();
  }, [canRecord]);

  // A recorder left running would keep the microphone on.
  useEffect(() => {
    gone.current = false;
    return () => {
      gone.current = true;
      if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop();
    };
  }, []);
  return { files, add, remove, clear, problem, recording, canRecord, toggleRecording, enabled, accept, max };
}

/** Object URLs for the images among `files`, released when the list changes. */
function usePreviews(files: readonly File[]): (string | undefined)[] {
  const [urls, setUrls] = useState<(string | undefined)[]>([]);
  // Made in an effect, so every URL made has a cleanup that releases it (a render may run twice).
  useEffect(() => {
    const made = files.map((file) =>
      file.type.startsWith('image/') && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
        ? URL.createObjectURL(file)
        : undefined,
    );
    setUrls(made);
    return () => {
      for (const url of made) if (url) URL.revokeObjectURL(url);
    };
  }, [files]);
  return urls;
}

function glyph(mediaType: string): string {
  return mediaType.startsWith('audio/') ? '♪' : mediaType.startsWith('image/') ? '▣' : '≡';
}

/** The files waiting in the composer, each with a button that takes it off. */
export function PendingAttachments({ files, onRemove }: { files: readonly File[]; onRemove(index: number): void }) {
  const previews = usePreviews(files);
  if (!files.length) return null;
  return (
    <div className="gc-attachments" aria-label="Attached files">
      {files.map((file, index) => (
        <span key={index} className="gc-attachment">
          {previews[index] ? <img src={previews[index]} alt="" /> : <i aria-hidden="true">{glyph(file.type)}</i>}
          <span className="gc-attachment-name" title={file.name}>
            {file.name}
          </span>
          <small>{formatBytes(file.size)}</small>
          <button type="button" aria-label={`Remove ${file.name}`} onClick={() => onRemove(index)}>
            ×
          </button>
        </span>
      ))}
    </div>
  );
}

/** The files a turn was sent with, under its prompt. */
export function TurnAttachments({ items }: { items: readonly TurnAttachment[] | undefined }) {
  if (!items?.length) return null;
  return (
    <div className="gc-attachments gc-sent" aria-label="Attached files">
      {items.map((item, index) =>
        item.url && item.mediaType.startsWith('image/') ? (
          <img key={index} className="gc-attachment-image" src={item.url} alt={item.name} title={item.name} />
        ) : item.url && item.mediaType.startsWith('audio/') ? (
          <audio
            key={index}
            className="gc-attachment-audio"
            src={item.url}
            controls
            preload="metadata"
            title={item.name}
          />
        ) : (
          <span key={index} className="gc-attachment">
            <i aria-hidden="true">{glyph(item.mediaType)}</i>
            <span className="gc-attachment-name" title={item.name}>
              {item.name}
            </span>
            <small>{formatBytes(item.size)}</small>
          </span>
        ),
      )}
    </div>
  );
}
