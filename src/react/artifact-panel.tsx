import { useEffect, useRef, useState, type RefObject } from 'react';
import type { Artifact } from '../agents/types.js';
import { formatBytes } from './format.js';
import { installResizeHandle, storedSize } from './resize-handle.js';

export const ARTIFACT_KIND: Record<Artifact['kind'], string> = {
  html: 'Page',
  image: 'Image',
  audio: 'Audio',
  video: 'Video',
  text: 'Document',
  file: 'File',
};

export function artifactKindLabel(artifact: Pick<Artifact, 'kind' | 'mimeType'>): string {
  if (artifact.mimeType === 'application/pdf') return 'PDF';
  return ARTIFACT_KIND[artifact.kind];
}

export type SubmitArtifact = (artifact: Artifact, data: unknown) => void;

// Larger than any form needs; a page cannot flood the conversation.
const SUBMIT_MAX = 20_000;

export type PendingArtifactSubmit = { data: unknown; json: string } | { tooLarge: true };

/** What a page's `postMessage` asks to send, as JSON text; undefined when it is not a submit. */
export function parseArtifactSubmission(message: unknown): PendingArtifactSubmit | undefined {
  if (typeof message !== 'object' || message === null) return undefined;
  if ((message as { genaicode?: unknown }).genaicode !== 'submit') return undefined;
  const data = (message as { data?: unknown }).data;
  let json: string | undefined;
  try {
    json = JSON.stringify(data, null, 2);
  } catch {
    return undefined;
  }
  if (json === undefined) return undefined;
  return json.length > SUBMIT_MAX ? { tooLarge: true } : { data: JSON.parse(json) as unknown, json };
}

/**
 * Listen for `{ genaicode: 'submit', data }` messages originating solely from `frame`.
 * Pending submissions reset whenever the frame closes or switches artifact / version.
 */
export function useArtifactSubmit(
  frame: RefObject<HTMLIFrameElement | null>,
  active: boolean,
  artifactId: string | undefined,
  version: number | undefined,
): [PendingArtifactSubmit | undefined, () => void] {
  const [asked, setAsked] = useState<PendingArtifactSubmit>();
  useEffect(() => {
    if (!active) return;
    const listen = (event: MessageEvent) => {
      // Only the frame of this viewer, whatever origin it claims.
      if (!frame.current || event.source !== frame.current.contentWindow) return;
      const next = parseArtifactSubmission(event.data);
      if (next) setAsked(next);
    };
    window.addEventListener('message', listen);
    return () => window.removeEventListener('message', listen);
  }, [active, frame]);
  useEffect(() => setAsked(undefined), [active, artifactId, version]);
  return [asked, () => setAsked(undefined)];
}

/** Confirmation strip attached to a sandboxed HTML frame that requested sending data to the agent. */
export function ArtifactSubmitBar({
  artifact,
  asked,
  onSubmit,
  onDismiss,
}: {
  artifact: Artifact;
  asked: PendingArtifactSubmit;
  onSubmit: SubmitArtifact;
  onDismiss(): void;
}) {
  const confirm = useRef<HTMLDivElement>(null);
  useEffect(() => {
    confirm.current?.scrollIntoView?.({ block: 'nearest' });
  }, [asked]);
  return (
    <div ref={confirm} className="gc-artifact-submit" role="group" aria-label="Send to the agent">
      {'tooLarge' in asked ? (
        <span className="gc-artifact-submit-text">This page tried to send more than fits in a message.</span>
      ) : (
        <>
          <span className="gc-artifact-submit-text">This page wants to send the agent:</span>
          <pre className="gc-artifact-submit-data">{asked.json}</pre>
        </>
      )}
      <span className="gc-artifact-submit-actions">
        {'tooLarge' in asked ? null : (
          <button
            type="button"
            className="gc-btn gc-primary"
            onClick={() => {
              onDismiss();
              onSubmit(artifact, asked.data);
            }}
          >
            Send to agent
          </button>
        )}
        <button type="button" className="gc-btn" onClick={onDismiss}>
          {'tooLarge' in asked ? 'Dismiss' : 'Discard'}
        </button>
      </span>
    </div>
  );
}

/** Add `download=1` to a URL without breaking existing query parameters. */
export function withDownloadParam(url: string): string {
  const [base, hash] = url.split('#', 2);
  const sep = base!.includes('?') ? '&' : '?';
  return `${base}${sep}download=1${hash ? `#${hash}` : ''}`;
}

/** WebKitGTK on Linux has no built-in PDF viewer in iframes. */
export function hasNoInlinePdfViewer(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /Linux/i.test(ua) && /AppleWebKit/i.test(ua) && !/Chrome|Chromium|Edg/i.test(ua);
}

/** Whether an artifact can be previewed (including PDFs). */
export function canPreviewArtifact(artifact: Pick<Artifact, 'kind' | 'mimeType'>): boolean {
  return artifact.kind !== 'file' || artifact.mimeType === 'application/pdf';
}

export interface ArtifactPanelProps {
  artifact: Artifact;
  /** All known versions of this artifact, oldest or newest first. Shows a version switcher when > 1. */
  versions?: readonly Artifact[];
  /** URL serving the artifact content (`artifactUrl(artifact)`). */
  url: string;
  /** Optional explicit Download URL. Defaults to `url` with `download=1`. */
  downloadUrl?: string;
  /** Called when the user switches to another version in the header. */
  onSelectVersion?(artifact: Artifact): void;
  /** Called after the user confirms data sent via `postMessage({ genaicode: 'submit', data })`. */
  onSubmit?: SubmitArtifact;
  onClose(): void;
  /** Allow resizing the panel's left edge and remembering its width. Default true. */
  resizable?: boolean;
  /** `localStorage` key for remembered width. Default `genaicode-artifact-panel-width`. */
  storageKey?: string;
  theme?: 'auto' | 'light' | 'dark';
  className?: string;
}

const DEFAULT_WIDTH = 640;
const MIN_WIDTH = 320;

/**
 * Side panel for inspecting a published artifact (HTML page, image, audio, video, PDF, text),
 * with version switching, full-size toggle, resize handle, download, and submit confirmation.
 */
export function ArtifactPanel({
  artifact,
  versions,
  url,
  downloadUrl,
  onSelectVersion,
  onSubmit,
  onClose,
  resizable = true,
  storageKey = 'genaicode-artifact-panel-width',
  theme,
  className,
}: ArtifactPanelProps) {
  const [fullSize, setFullSize] = useState(false);
  const [actualSize, setActualSize] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const [asked, clearAsked] = useArtifactSubmit(
    frame,
    !!onSubmit && artifact.kind === 'html',
    artifact.id,
    artifact.version,
  );

  useEffect(() => setActualSize(false), [artifact.id, artifact.version]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (document.body.dataset.resizing === 'true') return;
      event.stopPropagation();
      event.preventDefault();
      if (fullSize) setFullSize(false);
      else onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [fullSize, onClose]);

  useEffect(() => {
    if (!resizable || fullSize || !handleRef.current || !panelRef.current) return;
    const panel = panelRef.current;
    const store = storedSize(storageKey, [MIN_WIDTH, 1400]);
    let width = store.get();
    if (width) panel.style.setProperty('--gc-panel-width', `${width}px`);
    const handle = installResizeHandle(handleRef.current, {
      axis: 'x',
      direction: () => -1,
      bounds: () => [MIN_WIDTH, Math.max(MIN_WIDTH, window.innerWidth - 160)],
      read: () => width ?? Math.min(DEFAULT_WIDTH, Math.max(MIN_WIDTH, Math.round(window.innerWidth * 0.48))),
      write(next, commit) {
        width = next;
        panel.style.setProperty('--gc-panel-width', `${next}px`);
        if (commit) store.set(next);
      },
      reset() {
        width = undefined;
        panel.style.removeProperty('--gc-panel-width');
        store.clear();
      },
    });
    const onResize = () => handle.sync();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      handle.dispose();
    };
  }, [resizable, fullSize, storageKey]);

  const sortedVersions = versions?.length
    ? [...versions].sort((a, b) => b.version - a.version)
    : artifact.version > 1
      ? [artifact]
      : [];
  const isPdf = artifact.mimeType === 'application/pdf';
  const dlUrl = downloadUrl ?? withDownloadParam(url);
  const dataTheme = theme && theme !== 'auto' ? theme : undefined;

  return (
    <aside
      ref={panelRef}
      className={['gc-panel', fullSize ? 'gc-panel-full' : '', className ?? ''].filter(Boolean).join(' ')}
      data-theme={dataTheme}
      data-full-size={fullSize ? 'true' : undefined}
      aria-label={`Artifact ${artifact.title}`}
    >
      {resizable && !fullSize ? (
        <div
          ref={handleRef}
          className="gc-panel-resize"
          role="separator"
          tabIndex={0}
          aria-label="Resize viewer panel"
        />
      ) : null}
      <header className="gc-panel-header">
        <span className="gc-artifact-icon" aria-hidden="true">
          ◆
        </span>
        <strong className="gc-panel-title" title={artifact.path ?? artifact.title}>
          {artifact.title}
        </strong>
        <span className="gc-panel-meta">
          {artifactKindLabel(artifact)} · {formatBytes(artifact.bytes)}
        </span>
        {sortedVersions.length > 1 && onSelectVersion ? (
          <select
            className="gc-panel-version"
            aria-label="Version"
            value={artifact.version}
            onChange={(event) => {
              const target = sortedVersions.find((v) => v.version === Number(event.target.value));
              if (target) onSelectVersion(target);
            }}
          >
            {sortedVersions.map((v) => (
              <option key={v.version} value={v.version}>
                v{v.version}
              </option>
            ))}
          </select>
        ) : artifact.version > 1 ? (
          <span className="gc-panel-meta">v{artifact.version}</span>
        ) : null}
        <span className="gc-spacer" />
        <button
          type="button"
          className="gc-btn"
          aria-pressed={fullSize}
          title={fullSize ? 'Restore panel size (Esc)' : 'Full size'}
          onClick={() => setFullSize((v) => !v)}
        >
          {fullSize ? 'Exit full size' : 'Full size'}
        </button>
        {canPreviewArtifact(artifact) ? (
          <a className="gc-btn" href={url} target="_blank" rel="noopener noreferrer">
            New tab
          </a>
        ) : null}
        <a className="gc-btn" href={dlUrl} download>
          Download
        </a>
        <button type="button" className="gc-btn" onClick={onClose} title="Close (Esc)">
          Close
        </button>
      </header>
      <div className="gc-panel-body">
        {artifact.kind === 'image' ? (
          <div className={`gc-panel-stage gc-panel-image-stage${actualSize ? ' gc-actual' : ''}`}>
            <img
              src={url}
              alt={artifact.title}
              onClick={() => setActualSize((v) => !v)}
              title={actualSize ? 'Click to fit panel' : 'Click for actual size'}
            />
          </div>
        ) : artifact.kind === 'audio' ? (
          <div className="gc-panel-stage">
            <audio src={url} controls preload="metadata" />
          </div>
        ) : artifact.kind === 'video' ? (
          <div className="gc-panel-stage gc-panel-video-stage">
            <video src={url} controls preload="metadata" playsInline />
          </div>
        ) : isPdf ? (
          hasNoInlinePdfViewer() ? (
            <div className="gc-panel-stage gc-panel-fallback">
              <p>PDF preview is not built into this webview.</p>
              <div className="gc-panel-actions">
                <a className="gc-btn gc-primary" href={url} target="_blank" rel="noopener noreferrer">
                  Open externally
                </a>
                <a className="gc-btn" href={dlUrl} download>
                  Download
                </a>
              </div>
            </div>
          ) : (
            <iframe className="gc-panel-frame" title={artifact.title} src={url} referrerPolicy="no-referrer" />
          )
        ) : artifact.kind === 'file' ? (
          <div className="gc-panel-stage gc-panel-fallback">
            <p>
              <strong>{artifact.title}</strong> ({artifact.mimeType}, {formatBytes(artifact.bytes)})
            </p>
            <div className="gc-panel-actions">
              <a className="gc-btn gc-primary" href={dlUrl} download>
                Download
              </a>
            </div>
          </div>
        ) : (
          <iframe
            ref={frame}
            key={`${artifact.id}:${artifact.version}`}
            className="gc-panel-frame"
            title={artifact.title}
            src={url}
            sandbox={artifact.kind === 'html' ? 'allow-scripts' : ''}
            referrerPolicy="no-referrer"
          />
        )}
      </div>
      {asked && onSubmit ? (
        <ArtifactSubmitBar artifact={artifact} asked={asked} onSubmit={onSubmit} onDismiss={clearAsked} />
      ) : null}
    </aside>
  );
}
