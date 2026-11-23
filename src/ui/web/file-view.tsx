import { useEffect, useRef, useState, type MouseEvent } from 'react';
import type { Artifact } from '../../agents/types.js';
import { formatBytes } from '../../react/format.js';
import {
  artifactKindLabel,
  ArtifactSubmitBar,
  canPreviewArtifact,
  hasNoInlinePdfViewer,
  useArtifactSubmit,
  withDownloadParam,
  type SubmitArtifact,
} from '../../react/artifact-panel.js';
import {
  extractLocalImagePaths,
  formatFilePosition,
  Markdown,
  readFileLinkPosition,
  type FilePosition,
} from '../../react/markdown.js';
import { installResizeHandle, storedSize } from '../../react/resize-handle.js';
import type { FileKind, FileView } from '../files.js';

export interface SessionArtifactGroup {
  id: string;
  latest: Artifact;
  versions: Artifact[];
}

export type ViewerTarget =
  | { kind: 'file'; path: string; position?: FilePosition }
  | { kind: 'artifact'; id: string; version?: number };

const PROBLEMS: Record<string, string> = {
  outside: 'This file is outside the project, so it is not shown here.',
  secret: 'This file looks like a credential or internal file, so it is not shown here.',
  missing: 'This file is not there (it may have been moved or deleted).',
};

const FILE_KIND_LABEL: Record<FileKind, string> = {
  text: 'Text',
  markdown: 'Markdown',
  image: 'Image',
  audio: 'Audio',
  video: 'Video',
  pdf: 'PDF',
  html: 'HTML',
  other: 'File',
};

const MIN_WIDTH = 320;
const DEFAULT_WIDTH = 620;
const WIDTH_STORAGE_KEY = 'genaicode-viewer-width';
/** Renew the open file's `/files/<id>` capability before the server's 15-minute inactivity TTL. */
const FILE_CAPABILITY_REFRESH_MS = 10 * 60_000;

function isAbsoluteFilePath(value: string): boolean {
  return value.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(value);
}

/** Resolve a link or image target from inside an open Markdown file relative to that file's directory. */
function resolveRelativeToFile(baseFile: string, target: string): string {
  if (!target || isAbsoluteFilePath(target)) return target;
  const normBase = baseFile.replace(/\\/g, '/');
  const normTarget = target.replace(/\\/g, '/');
  const winDrive = /^[a-zA-Z]:/.exec(normBase)?.[0] ?? '';
  const withoutDrive = winDrive ? normBase.slice(winDrive.length) : normBase;
  const absolute = withoutDrive.startsWith('/');
  const slash = withoutDrive.lastIndexOf('/');
  const baseDir = slash >= 0 ? withoutDrive.slice(0, slash) : '';
  const combined = baseDir ? `${baseDir}/${normTarget}` : normTarget;
  const parts: string[] = [];
  for (const segment of combined.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (parts.length && parts[parts.length - 1] !== '..') parts.pop();
      else if (!absolute) parts.push('..');
    } else {
      parts.push(segment);
    }
  }
  if (absolute) return `${winDrive}/${parts.join('/')}`;
  return parts.join('/') || '.';
}

export interface ViewerPanelProps {
  target: ViewerTarget;
  token: string;
  /** Published artifacts in this session, for live updates and version switching. */
  artifacts: readonly SessionArtifactGroup[];
  /** True when the host shell supports revealing a file in Finder / file manager. */
  canReveal?: boolean;
  onReveal?(path: string): void;
  /** Open another file linked from inside a Markdown preview. */
  onOpenFile?(path: string, position?: FilePosition): void;
  imageUrl?(path: string): string | undefined;
  /** Change the selected version of an open artifact. Pass undefined to follow latest. */
  onSelectArtifactVersion?(version: number | undefined): void;
  /** Called when the user confirms a submission from an HTML artifact inside the panel. */
  onArtifactSubmit?: SubmitArtifact;
  onClose(): void;
}

/**
 * Unified side panel beside the chat: shows either a project file (text with line jump, Markdown
 * with source toggle, image with fit/actual-size, audio, video, PDF, sandboxed HTML with source
 * toggle, or binary download/reveal) or a published artifact (with version switcher, submit
 * confirmation, full size, New tab and Download). Resizable via the shared resize-handle.
 */
export function ViewerPanel({
  target,
  token,
  artifacts,
  canReveal,
  onReveal,
  onOpenFile,
  imageUrl,
  onSelectArtifactVersion,
  onArtifactSubmit,
  onClose,
}: ViewerPanelProps) {
  const [fullSize, setFullSize] = useState(false);
  const [file, setFile] = useState<FileView>();
  const [problem, setProblem] = useState<{ code: string; message: string }>();
  const [showSource, setShowSource] = useState(false);
  const [actualSize, setActualSize] = useState(false);
  const [dims, setDims] = useState<{ width: number; height: number }>();
  const [docImages, setDocImages] = useState<Record<string, string>>({});
  const [docImageTick, setDocImageTick] = useState(0);
  const panelRef = useRef<HTMLElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLPreElement>(null);
  const markdownRef = useRef<HTMLDivElement>(null);
  const artifactFrameRef = useRef<HTMLIFrameElement>(null);
  const docImagesRef = useRef(docImages);
  docImagesRef.current = docImages;
  const retriedDocUrl = useRef(new Map<string, string>());
  const fileFetchedAtRef = useRef(0);
  const retriedRawUrlRef = useRef<string | undefined>(undefined);
  const fileRef = useRef(file);
  fileRef.current = file;

  const artifactGroup = target.kind === 'artifact' ? artifacts.find((g) => g.id === target.id) : undefined;
  const activeArtifact =
    artifactGroup &&
    (target.kind === 'artifact' && target.version !== undefined
      ? (artifactGroup.versions.find((v) => v.version === target.version) ?? artifactGroup.latest)
      : artifactGroup.latest);

  const [asked, clearAsked] = useArtifactSubmit(
    artifactFrameRef,
    target.kind === 'artifact' && !!activeArtifact && activeArtifact.kind === 'html' && !!onArtifactSubmit,
    activeArtifact?.id,
    activeArtifact?.version,
  );

  // Fetch file view whenever the target file path changes.
  const filePath = target.kind === 'file' ? target.path : undefined;
  const fileLine = target.kind === 'file' ? target.position?.line : undefined;
  const fileEndLine = target.kind === 'file' ? target.position?.endLine : undefined;

  useEffect(() => {
    setActualSize(false);
    setDims(undefined);
    // Opening a Markdown or HTML file with a specific `:line` starts in Source mode so the line is visible.
    setShowSource(fileLine !== undefined);
  }, [filePath, fileLine, target.kind, activeArtifact?.id, activeArtifact?.version]);

  useEffect(() => {
    if (!filePath) {
      setFile(undefined);
      setProblem(undefined);
      fileFetchedAtRef.current = 0;
      retriedRawUrlRef.current = undefined;
      return;
    }
    const abort = new AbortController();
    setFile(undefined);
    setProblem(undefined);
    fileFetchedAtRef.current = 0;
    retriedRawUrlRef.current = undefined;
    fetch(`/api/file?path=${encodeURIComponent(filePath)}`, {
      headers: { 'x-genaicode-token': token },
      signal: abort.signal,
    })
      .then(async (res) => {
        const body = (await res.json()) as FileView & { error?: string };
        if (res.ok) {
          fileFetchedAtRef.current = Date.now();
          setFile(body);
        } else {
          const code = body.error ?? 'error';
          setProblem({ code, message: PROBLEMS[code] ?? 'The file could not be read.' });
        }
      })
      .catch(() => {
        if (!abort.signal.aborted) setProblem({ code: 'error', message: 'The file could not be read.' });
      });
    return () => abort.abort();
  }, [filePath, token]);

  const refreshFileCapability = async (signal?: AbortSignal): Promise<string | undefined> => {
    const current = fileRef.current;
    const queryPath = current?.fullPath ?? filePath;
    if (!queryPath || !token) return current?.rawUrl;
    try {
      const res = await fetch(`/api/file?path=${encodeURIComponent(queryPath)}`, {
        headers: { 'x-genaicode-token': token },
        signal,
      });
      if (!res.ok) return current?.rawUrl;
      const body = (await res.json()) as FileView;
      if (signal?.aborted) return body.rawUrl;
      fileFetchedAtRef.current = Date.now();
      if (body.rawUrl && body.rawUrl !== fileRef.current?.rawUrl) {
        if (retriedRawUrlRef.current !== body.rawUrl) retriedRawUrlRef.current = undefined;
        setFile((prev) => (prev ? { ...prev, ...body } : body));
      }
      return body.rawUrl;
    } catch {
      return current?.rawUrl;
    }
  };

  // Proactively keep the open file's `/files/<id>` capability alive before the 15-minute server TTL.
  const openRawUrl = file?.rawUrl;
  useEffect(() => {
    if (!filePath || !openRawUrl || !token) return;
    const abort = new AbortController();
    const timer = window.setInterval(() => void refreshFileCapability(abort.signal), FILE_CAPABILITY_REFRESH_MS);
    const onVisible = () => {
      if (
        document.visibilityState === 'visible' &&
        Date.now() - fileFetchedAtRef.current >= FILE_CAPABILITY_REFRESH_MS
      ) {
        void refreshFileCapability(abort.signal);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      abort.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [filePath, openRawUrl, token]);

  // Switching an HTML or Markdown file from Source back to Preview also renews a stale capability.
  useEffect(() => {
    if (showSource || !file?.rawUrl) return;
    if (Date.now() - fileFetchedAtRef.current >= FILE_CAPABILITY_REFRESH_MS) {
      void refreshFileCapability();
    }
  }, [showSource, file?.rawUrl]);

  // Resolve local images referenced inside an open Markdown file relative to the matched file's real directory.
  const markdownBasePath =
    file?.fullPath ?? (filePath && isAbsoluteFilePath(filePath) ? filePath : (file?.path ?? filePath ?? ''));
  useEffect(() => {
    setDocImages({});
    retriedDocUrl.current.clear();
  }, [filePath, file?.fullPath, file?.path]);

  useEffect(() => {
    if (!file || file.kind !== 'markdown' || !file.text || !token) return;
    const rawPaths = [...new Set(extractLocalImagePaths(file.text))];
    if (!rawPaths.length) return;
    const resolvedByRaw = new Map<string, string>();
    const uniqueResolved: string[] = [];
    for (const raw of rawPaths) {
      const resolved = resolveRelativeToFile(markdownBasePath, raw);
      resolvedByRaw.set(raw, resolved);
      if (!uniqueResolved.includes(resolved)) uniqueResolved.push(resolved);
    }
    const abort = new AbortController();
    void (async () => {
      const resolvedUrls: Record<string, string> = {};
      for (let i = 0; i < uniqueResolved.length; i += 100) {
        if (abort.signal.aborted) return;
        const batch = uniqueResolved.slice(i, i + 100);
        try {
          const res = await fetch('/api/file/images', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-genaicode-token': token },
            body: JSON.stringify({ paths: batch }),
            signal: abort.signal,
          });
          if (!res.ok) continue;
          const body = (await res.json()) as { urls?: Record<string, string> };
          if (body?.urls) Object.assign(resolvedUrls, body.urls);
        } catch {
          if (abort.signal.aborted) return;
        }
      }
      if (abort.signal.aborted) return;
      const mapped: Record<string, string> = {};
      for (const [raw, resolved] of resolvedByRaw) {
        const url = resolvedUrls[resolved];
        if (url) {
          if (retriedDocUrl.current.get(raw) !== url) retriedDocUrl.current.delete(raw);
          mapped[raw] = url;
        }
      }
      setDocImages(mapped);
    })();
    return () => abort.abort();
  }, [file, markdownBasePath, token, docImageTick]);

  // If a rendered Markdown document's image capability expires, refresh it once on load error.
  useEffect(() => {
    const container = markdownRef.current;
    if (!container || file?.kind !== 'markdown') return;
    const onImageError = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLImageElement) || !target.classList.contains('gc-md-image')) return;
      const raw = target.closest('[data-gc-file]')?.getAttribute('data-gc-file');
      if (!raw) return;
      const cached = docImagesRef.current[raw];
      if (!cached || retriedDocUrl.current.get(raw) === cached) return;
      retriedDocUrl.current.set(raw, cached);
      setDocImageTick((n) => n + 1);
    };
    container.addEventListener('error', onImageError, true);
    return () => container.removeEventListener('error', onImageError, true);
  }, [file?.kind, showSource]);

  // Scroll to and highlight the target line once text lines are rendered.
  useEffect(() => {
    if (!file || !fileLine) return;
    if ((file.kind === 'markdown' || file.kind === 'html') && !showSource) return;
    const container = textRef.current;
    if (!container) return;
    const lineEl = container.querySelector(`[data-line="${fileLine}"]`);
    lineEl?.scrollIntoView?.({ block: 'center' });
  }, [file, fileLine, fileEndLine, showSource]);

  // Esc order: full size -> panel -> (next press reaches chat to stop the agent).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Let an active resize drag undo itself before closing the panel.
      if (document.body.dataset.resizing === 'true') return;
      event.stopPropagation();
      event.preventDefault();
      if (fullSize) setFullSize(false);
      else onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [fullSize, onClose]);

  // Shared resize-handle on the left edge, persisted in localStorage.
  useEffect(() => {
    if (fullSize || !handleRef.current || !panelRef.current) return;
    const panel = panelRef.current;
    const store = storedSize(WIDTH_STORAGE_KEY, [MIN_WIDTH, 1400]);
    let width = store.get();
    if (width) panel.style.setProperty('--viewer-width', `${width}px`);
    const handle = installResizeHandle(handleRef.current, {
      axis: 'x',
      direction: () => -1,
      bounds: () => [MIN_WIDTH, Math.max(MIN_WIDTH, window.innerWidth - 200)],
      read: () => width ?? Math.min(DEFAULT_WIDTH, Math.max(MIN_WIDTH, Math.round(window.innerWidth * 0.48))),
      write(next, commit) {
        width = next;
        panel.style.setProperty('--viewer-width', `${next}px`);
        if (commit) store.set(next);
      },
      reset() {
        width = undefined;
        panel.style.removeProperty('--viewer-width');
        store.clear();
      },
    });
    const onResize = () => handle.sync();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      handle.dispose();
    };
  }, [fullSize]);

  const revealLabel = /Mac/.test(navigator.platform) ? 'Reveal in Finder' : 'Reveal';

  if (target.kind === 'artifact') {
    const artifact = activeArtifact;
    const url = artifact ? `/artifacts/${artifact.id}?v=${artifact.version}` : undefined;
    const dlUrl = url ? withDownloadParam(url) : undefined;
    const versions = artifactGroup ? [...artifactGroup.versions].sort((a, b) => b.version - a.version) : [];
    const isPdf = artifact?.mimeType === 'application/pdf';
    return (
      <aside
        ref={panelRef}
        className={`viewer-panel${fullSize ? ' full-size' : ''}`}
        data-viewer-kind="artifact"
        data-full-size={fullSize ? 'true' : undefined}
        aria-label={artifact ? `Artifact ${artifact.title}` : 'Artifact'}
      >
        {!fullSize ? (
          <div
            ref={handleRef}
            className="viewer-resize"
            role="separator"
            tabIndex={0}
            aria-label="Resize viewer panel"
          />
        ) : null}
        <header>
          <span className="viewer-icon" aria-hidden="true">
            ◆
          </span>
          <strong className="viewer-title" title={artifact?.path ?? artifact?.title}>
            {artifact?.title ?? 'Artifact'}
          </strong>
          {artifact ? (
            <small>
              {artifactKindLabel(artifact)} · {formatBytes(artifact.bytes)}
              {dims ? ` · ${dims.width}×${dims.height}` : ''}
            </small>
          ) : null}
          {artifact && versions.length > 1 ? (
            <select
              className="viewer-version"
              aria-label="Version"
              value={artifact.version}
              onChange={(event) => {
                const picked = Number(event.target.value);
                onSelectArtifactVersion?.(picked === artifactGroup?.latest.version ? undefined : picked);
              }}
            >
              {versions.map((v) => (
                <option key={v.version} value={v.version}>
                  v{v.version}
                  {v.version === artifactGroup?.latest.version ? ' (latest)' : ''}
                </option>
              ))}
            </select>
          ) : artifact && artifact.version > 1 ? (
            <small>v{artifact.version}</small>
          ) : null}
          <span className="spacer" />
          {artifact?.kind === 'image' ? (
            <button type="button" className="chip" aria-pressed={actualSize} onClick={() => setActualSize((v) => !v)}>
              {actualSize ? 'Fit' : 'Actual size'}
            </button>
          ) : null}
          <button
            type="button"
            className="chip"
            aria-pressed={fullSize}
            title={fullSize ? 'Exit full size (Esc)' : 'Full size'}
            onClick={() => setFullSize((v) => !v)}
          >
            {fullSize ? 'Restore' : 'Full size'}
          </button>
          {url && artifact && canPreviewArtifact(artifact) ? (
            <a className="chip" href={url} target="_blank" rel="noopener noreferrer">
              New tab
            </a>
          ) : null}
          {dlUrl ? (
            <a className="chip" href={dlUrl} download>
              Download
            </a>
          ) : null}
          <button type="button" className="chip" onClick={onClose} title="Close (Esc)">
            Close
          </button>
        </header>
        {!artifact || !url ? (
          <p className="file-problem">This artifact is no longer available.</p>
        ) : (
          <>
            <div className="viewer-body">
              {artifact.kind === 'image' ? (
                <div className={`viewer-stage viewer-image-stage${actualSize ? ' actual' : ''}`}>
                  <img
                    src={url}
                    alt={artifact.title}
                    onClick={() => setActualSize((v) => !v)}
                    onLoad={(event) =>
                      setDims({
                        width: event.currentTarget.naturalWidth,
                        height: event.currentTarget.naturalHeight,
                      })
                    }
                    title={actualSize ? 'Click to fit panel' : 'Click for actual size'}
                  />
                </div>
              ) : artifact.kind === 'audio' ? (
                <div className="viewer-stage">
                  <audio src={url} controls preload="metadata" />
                </div>
              ) : artifact.kind === 'video' ? (
                <div className="viewer-stage viewer-video-stage">
                  <video src={url} controls preload="metadata" playsInline />
                </div>
              ) : isPdf ? (
                hasNoInlinePdfViewer() ? (
                  <div className="viewer-stage viewer-fallback">
                    <p>PDF preview is not built into this webview.</p>
                    <div className="viewer-actions">
                      <a className="chip primary" href={url} target="_blank" rel="noopener noreferrer">
                        Open externally
                      </a>
                      <a className="chip" href={dlUrl} download>
                        Download
                      </a>
                    </div>
                  </div>
                ) : (
                  <iframe className="viewer-frame" title={artifact.title} src={url} referrerPolicy="no-referrer" />
                )
              ) : artifact.kind === 'file' ? (
                <div className="viewer-stage viewer-fallback">
                  <p>
                    <strong>{artifact.title}</strong>
                  </p>
                  <p className="viewer-meta">
                    {artifact.mimeType} · {formatBytes(artifact.bytes)}
                  </p>
                  <div className="viewer-actions">
                    <a className="chip primary" href={dlUrl} download>
                      Download
                    </a>
                  </div>
                </div>
              ) : (
                <iframe
                  ref={artifactFrameRef}
                  key={`${artifact.id}:${artifact.version}`}
                  className="viewer-frame"
                  title={artifact.title}
                  src={url}
                  sandbox={artifact.kind === 'html' ? 'allow-scripts' : ''}
                  referrerPolicy="no-referrer"
                />
              )}
            </div>
            {asked && onArtifactSubmit ? (
              <ArtifactSubmitBar artifact={artifact} asked={asked} onSubmit={onArtifactSubmit} onDismiss={clearAsked} />
            ) : null}
          </>
        )}
      </aside>
    );
  }

  // File mode
  const position = target.position;
  const displayName = `${file?.path ?? target.path}${position ? `:${formatFilePosition(position)}` : ''}`;
  const rawUrl = file?.rawUrl;
  const dlUrl = rawUrl ? withDownloadParam(rawUrl) : undefined;
  const lines = file?.text !== undefined ? file.text.replace(/\n$/, '').split('\n') : [];
  const hasSourceToggle = file?.kind === 'markdown' || file?.kind === 'html';
  const showTextLines = file?.kind === 'text' || (hasSourceToggle && showSource);
  const canOpenTab =
    !!rawUrl &&
    (file?.kind === 'image' ||
      file?.kind === 'audio' ||
      file?.kind === 'video' ||
      file?.kind === 'pdf' ||
      file?.kind === 'html');

  const renderLines = () => (
    <>
      <pre ref={textRef} className="file-text">
        {lines.map((line, index) => {
          const lineNo = index + 1;
          const marked =
            position !== undefined && lineNo >= position.line && lineNo <= (position.endLine ?? position.line);
          return (
            <span key={index} data-line={lineNo} className={marked ? 'file-line-mark' : undefined}>
              {line || ' '}
            </span>
          );
        })}
      </pre>
      {file?.truncated ? <p className="file-problem">The file is longer; this is its start.</p> : null}
    </>
  );

  const handleRawAction = (mode: 'tab' | 'download') => (event: MouseEvent<HTMLAnchorElement>) => {
    if (!rawUrl || Date.now() - fileFetchedAtRef.current < FILE_CAPABILITY_REFRESH_MS) return;
    event.preventDefault();
    void refreshFileCapability().then((fresh) => {
      const url = fresh ?? rawUrl;
      if (mode === 'tab') {
        window.open(url, '_blank', 'noopener,noreferrer');
      } else {
        const anchor = document.createElement('a');
        anchor.href = withDownloadParam(url);
        anchor.download = '';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      }
    });
  };

  return (
    <aside
      ref={panelRef}
      className={`viewer-panel${fullSize ? ' full-size' : ''}`}
      data-viewer-kind="file"
      data-file-kind={file?.kind}
      data-full-size={fullSize ? 'true' : undefined}
      aria-label={`File ${file?.path ?? target.path}`}
    >
      {!fullSize ? (
        <div ref={handleRef} className="viewer-resize" role="separator" tabIndex={0} aria-label="Resize viewer panel" />
      ) : null}
      <header>
        <code className="viewer-title" title={target.path}>
          {displayName}
        </code>
        {file ? (
          <small>
            {FILE_KIND_LABEL[file.kind]} · {formatBytes(file.size)}
            {dims ? ` · ${dims.width}×${dims.height}` : ''}
          </small>
        ) : null}
        <span className="spacer" />
        {hasSourceToggle ? (
          <button type="button" className="chip" aria-pressed={showSource} onClick={() => setShowSource((v) => !v)}>
            {showSource ? 'Preview' : 'Source'}
          </button>
        ) : null}
        {file?.kind === 'image' ? (
          <button type="button" className="chip" aria-pressed={actualSize} onClick={() => setActualSize((v) => !v)}>
            {actualSize ? 'Fit' : 'Actual size'}
          </button>
        ) : null}
        <button
          type="button"
          className="chip"
          aria-pressed={fullSize}
          title={fullSize ? 'Exit full size (Esc)' : 'Full size'}
          onClick={() => setFullSize((v) => !v)}
        >
          {fullSize ? 'Restore' : 'Full size'}
        </button>
        {canOpenTab ? (
          <a className="chip" href={rawUrl} target="_blank" rel="noopener noreferrer" onClick={handleRawAction('tab')}>
            {file?.kind === 'pdf' && hasNoInlinePdfViewer() ? 'Open externally' : 'New tab'}
          </a>
        ) : null}
        {dlUrl ? (
          <a className="chip" href={dlUrl} download onClick={handleRawAction('download')}>
            Download
          </a>
        ) : null}
        {canReveal && onReveal && problem?.code !== 'secret' && problem?.code !== 'missing' ? (
          <button type="button" className="chip" onClick={() => onReveal(file?.fullPath ?? target.path)}>
            {revealLabel}
          </button>
        ) : null}
        <button type="button" className="chip" onClick={onClose} title="Close (Esc)">
          Close
        </button>
      </header>
      {problem ? (
        <div className="viewer-stage viewer-fallback">
          <p className="file-problem">{problem.message}</p>
          <code className="viewer-refused-path">{target.path}</code>
          {problem.code === 'outside' && canReveal && onReveal ? (
            <div className="viewer-actions">
              <button type="button" className="chip primary" onClick={() => onReveal(target.path)}>
                {revealLabel}
              </button>
            </div>
          ) : null}
        </div>
      ) : !file ? (
        <p className="file-problem">Reading…</p>
      ) : showTextLines ? (
        <div className="viewer-body">{renderLines()}</div>
      ) : file.kind === 'markdown' ? (
        <div
          ref={markdownRef}
          className="viewer-body viewer-markdown"
          onClick={
            onOpenFile
              ? (event) => {
                  const el = (event.target as Element).closest?.('[data-gc-file]');
                  const clicked = el?.getAttribute('data-gc-file');
                  if (el && clicked)
                    onOpenFile(resolveRelativeToFile(markdownBasePath, clicked), readFileLinkPosition(el));
                }
              : undefined
          }
        >
          <Markdown
            text={file.text ?? ''}
            imageUrl={(path) => docImages[path] ?? imageUrl?.(resolveRelativeToFile(markdownBasePath, path))}
          />
          {file.truncated ? <p className="file-problem">The file is longer; this is its start.</p> : null}
        </div>
      ) : file.kind === 'image' && rawUrl ? (
        <div className="viewer-body">
          <div className={`viewer-stage viewer-image-stage${actualSize ? ' actual' : ''}`}>
            <img
              src={rawUrl}
              alt={file.path}
              onClick={() => setActualSize((v) => !v)}
              onError={() => {
                if (retriedRawUrlRef.current === rawUrl) return;
                retriedRawUrlRef.current = rawUrl;
                void refreshFileCapability();
              }}
              onLoad={(event) =>
                setDims({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                })
              }
              title={actualSize ? 'Click to fit panel' : 'Click for actual size'}
            />
          </div>
        </div>
      ) : file.kind === 'audio' && rawUrl ? (
        <div className="viewer-body">
          <div className="viewer-stage">
            <audio src={rawUrl} controls preload="metadata" />
          </div>
        </div>
      ) : file.kind === 'video' && rawUrl ? (
        <div className="viewer-body">
          <div className="viewer-stage viewer-video-stage">
            <video src={rawUrl} controls preload="metadata" playsInline />
          </div>
        </div>
      ) : file.kind === 'pdf' && rawUrl ? (
        <div className="viewer-body">
          {hasNoInlinePdfViewer() ? (
            <div className="viewer-stage viewer-fallback">
              <p>PDF preview is not built into this webview.</p>
              <div className="viewer-actions">
                <a
                  className="chip primary"
                  href={rawUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={handleRawAction('tab')}
                >
                  Open externally
                </a>
                {dlUrl ? (
                  <a className="chip" href={dlUrl} download onClick={handleRawAction('download')}>
                    Download
                  </a>
                ) : null}
                {canReveal && onReveal ? (
                  <button type="button" className="chip" onClick={() => onReveal(file.fullPath ?? target.path)}>
                    {revealLabel}
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <iframe key={rawUrl} className="viewer-frame" title={file.path} src={rawUrl} referrerPolicy="no-referrer" />
          )}
        </div>
      ) : file.kind === 'html' && rawUrl ? (
        <div className="viewer-body">
          <iframe
            key={rawUrl}
            className="viewer-frame"
            title={file.path}
            src={rawUrl}
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
          />
        </div>
      ) : (
        <div className="viewer-body">
          <div className="viewer-stage viewer-fallback">
            <p>
              <strong>{file.path}</strong>
            </p>
            <p className="viewer-meta">
              {file.mimeType} · {formatBytes(file.size)}
            </p>
            <div className="viewer-actions">
              {dlUrl ? (
                <a className="chip primary" href={dlUrl} download onClick={handleRawAction('download')}>
                  Download
                </a>
              ) : null}
              {canReveal && onReveal ? (
                <button type="button" className="chip" onClick={() => onReveal(file.fullPath ?? target.path)}>
                  {revealLabel}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
