import { realpathSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homeOf } from '../agents/sessions/files.js';
import type { SessionInfo } from '../agents/sessions/types.js';
import { createProjectFiles, type ProjectFiles } from './files.js';
import type { storedConversation } from './transcript.js';

export interface ThreadDocument {
  path: string;
  title: string;
  text: string;
  truncated: boolean;
  mentions: Array<{ turn: number; part: number }>;
  media: Array<{ label: string; url: string; video: boolean }>;
}

// Antigravity uses ordinary Markdown links to its per-conversation brain directory.
function* links(markdown: string) {
  for (const match of markdown.matchAll(
    /!?\[([^\]\n]{0,500})\]\(\s*(?:<([^<>\n]{1,2000})>|([^\s)\n]{1,2000}))\s*\)/g,
  )) {
    yield { label: match[1]!, target: match[2] ?? match[3]! };
  }
}

function localPath(target: string, folder: string, root: string): string | undefined {
  try {
    if (target.startsWith('file://')) target = fileURLToPath(target);
    else if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) return;
    else target = decodeURIComponent(target);
    const absolute = resolve(folder, target);
    const rel = relative(root, absolute);
    if (!rel || rel.split(sep).some((part) => part.startsWith('.'))) return;
    return absolute;
  } catch {
    return;
  }
}

/** Preview documents linked by the agent, within the store that owns this exact transcript. */
export function sessionDocuments(env: NodeJS.ProcessEnv) {
  const scopes = new Map<string, ProjectFiles>();
  return {
    read(session: SessionInfo, turns: ReturnType<typeof storedConversation>['turns']): ThreadDocument[] {
      if (
        session.source !== 'antigravity' ||
        session.agent !== 'antigravity' ||
        session.where !== 'local' ||
        !session.path ||
        !/^[a-z0-9_-]+$/i.test(session.id)
      )
        return [];
      const home = homeOf(env);
      const root = ['antigravity', 'antigravity-cli']
        .map((store) => join(home, '.gemini', store, 'brain', session.id))
        .find((dir) => join(dir, '.system_generated', 'logs', 'transcript.jsonl') === session.path);
      if (!root) return [];
      const allowed = () => {
        try {
          return realpathSync(root) === join(realpathSync(home), relative(home, root)) ? root : [];
        } catch {
          return [];
        }
      };
      if (!allowed().length) return [];
      const files = scopes.get(root) ?? createProjectFiles(allowed);
      scopes.delete(root);
      scopes.set(root, files);
      if (scopes.size > 32) scopes.delete(scopes.keys().next().value!);
      const documents = new Map<string, ThreadDocument>();
      const attempted = new Set<string>();
      // Read the newest linked documents first. A long thread must not inflate each refresh.
      for (const turn of [...turns].reverse()) {
        for (const [part, message] of turn.parts.entries()) {
          if (message.role !== 'agent') continue;
          for (const { target } of links(message.text)) {
            if (!/\.md$/i.test(target)) continue;
            const path = localPath(target, root, root);
            if (!path) continue;
            let doc = documents.get(path);
            if (!doc) {
              if (documents.size >= 8 || attempted.has(path) || attempted.size >= 32) continue;
              attempted.add(path);
              const file = files.read(path);
              if (typeof file === 'string' || file.kind !== 'markdown' || !file.text) continue;
              const text = file.text.slice(0, 32000);
              const title = /^#\s+(.+)/m.exec(text)?.[1]?.trim() || basename(path);
              doc = {
                path,
                title,
                text,
                truncated: !!file.truncated || text.length < file.text.length,
                mentions: [],
                media: [],
              };
              const images = new Set<string>();
              for (const link of links(text)) {
                if (images.size >= 24) break;
                if (!/\.(?:png|jpe?g|webp|gif|mp4|webm)$/i.test(link.target)) continue;
                const mediaPath = localPath(link.target, dirname(path), root);
                if (!mediaPath || images.has(mediaPath)) continue;
                images.add(mediaPath);
                const video = /\.(?:mp4|webm)$/i.test(mediaPath);
                const cap = files.capability(mediaPath, { onlyKind: video ? 'video' : 'image' });
                if (cap && /^(image\/(png|jpeg|webp|gif)|video\/(mp4|webm))$/.test(cap.raw.mimeType))
                  doc.media.push({ label: link.label || basename(mediaPath), url: '/files/' + cap.id, video });
              }
              documents.set(path, doc);
            }
            if (!doc.mentions.some((m) => m.turn === turn.id && m.part === part))
              doc.mentions.push({ turn: turn.id, part });
          }
        }
      }
      return [...documents.values()];
    },
    fromCapability(id: string) {
      for (const scope of scopes.values()) {
        const raw = scope.fromCapability(id);
        if (raw && /^(image\/(png|jpeg|webp|gif)|video\/(mp4|webm))$/.test(raw.mimeType)) return raw;
      }
    },
  };
}
