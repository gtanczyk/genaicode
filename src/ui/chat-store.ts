import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { genaicodeHomeDir, readConversations, removeConversationRecords } from '../agents/sessions/workspace.js';
import type { SessionInfo } from '../agents/sessions/types.js';
import type { SavedPackTask } from '../agents/pack.js';
import type { SessionState } from '../agents/session.js';
import type { ChatSummary } from './hub.js';
import type { ConversationMeta } from './controller.js';

export interface SavedChat {
  source?: string;
  conversation: ConversationMeta;
  session: Pick<
    SessionState,
    'agent' | 'cwd' | 'model' | 'effort' | 'mode' | 'usage' | 'costUsd' | 'turns' | 'sessionId' | 'truncatedReason'
  >;
  packs: Record<string, SavedPackTask[]>;
  interrupted: boolean;
  drafts?: string[];
}

export function chatStore(env: NodeJS.ProcessEnv, cwd: string, home: boolean) {
  const workspace = createHash('sha256')
    .update(JSON.stringify([home, cwd]))
    .digest('hex');
  const dir = join(genaicodeHomeDir(env), 'ui-chats', workspace);
  const deletedDir = join(dir, 'deleted-sessions');
  const fingerprint = (row: Pick<SessionInfo, 'source' | 'id'>) =>
    createHash('sha256')
      .update(JSON.stringify([row.source, row.id]))
      .digest('hex');
  const valid = (id: unknown): id is string => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id);
  // Queue atomic replacements in submission order. Capture the snapshot before the next turn changes it.
  const writes = new Map<string, Promise<void>>();
  const queue = (name: string, action: () => Promise<void>) => {
    const work = (writes.get(name) ?? Promise.resolve()).catch(() => {}).then(action);
    writes.set(name, work);
    return work.finally(() => {
      if (writes.get(name) === work) writes.delete(name);
    });
  };
  const write = (name: string, data: unknown) => {
    const json = JSON.stringify(data);
    return queue(name, async () => {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const file = join(dir, name);
      const tmp = file + '.' + randomUUID() + '.tmp';
      await writeFile(tmp, json, { mode: 0o600 });
      await rename(tmp, file);
    });
  };
  return {
    // The agent still owns its transcript. Remember the key so a native listing cannot
    // import the deleted history again. Individual marker files support concurrent deletions.
    async visibleSessions(rows: SessionInfo[]) {
      const deleted = new Set(
        await readdir(deletedDir).catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return [];
          throw error;
        }),
      );
      return deleted.size ? rows.filter((row) => !deleted.has(fingerprint(row))) : rows;
    },
    async erase(row: SessionInfo, recordId?: string) {
      const records = await readConversations(env);
      const matches = records.filter(
        (r) =>
          r.id === recordId || (r.sessionId === row.id && (r.source ? r.source === row.source : r.agent === row.agent)),
      );
      const ids = new Set(matches.map((r) => r.id));
      if (recordId) ids.add(recordId);
      await mkdir(deletedDir, { recursive: true, mode: 0o700 });
      // Older snapshots may use a different file id than their conversation record (after /clear).
      // Compare inside the write queue, so an old confirmation cannot erase a replacement chat.
      for (const file of await readdir(dir)) {
        if (!file.endsWith('.json') || !valid(file.slice(0, -5))) continue;
        await queue(file, async () => {
          const saved = await this.read(file.slice(0, -5));
          if (!saved) return;
          const key = saved.conversation.recordId ?? saved.conversation.id;
          if (!ids.has(key) && !(saved.session.sessionId === row.id && saved.source === row.source)) return;
          ids.add(key);
          await rm(join(dir, file), { force: true });
        });
      }
      await writeFile(join(deletedDir, fingerprint(row)), '', { mode: 0o600 });
      await removeConversationRecords(ids, env);
    },
    async readProjectOrder(): Promise<string[]> {
      try {
        const keys: unknown = JSON.parse(await readFile(join(dir, 'project-order.json'), 'utf8'));
        if (Array.isArray(keys) && keys.every((key) => typeof key === 'string')) return keys;
      } catch {
        // Until an order is saved, the sidebar follows recent activity.
      }
      return [];
    },
    saveProjectOrder: (keys: string[]) => write('project-order.json', keys),
    async read(id: string): Promise<SavedChat | undefined> {
      if (!valid(id)) return;
      try {
        const data = JSON.parse(await readFile(join(dir, id + '.json'), 'utf8')) as SavedChat;
        if (data.conversation?.id === id && Array.isArray(data.session?.turns) && data.packs) return data;
      } catch {
        /* A missing record cannot be reopened. */
      }
    },
    save: (data: SavedChat) => write(data.conversation.id + '.json', data),
    saveIndex: (ids: string[], shown: string, chats: ChatSummary[]) => write('ui-chats.json', { ids, shown, chats }),
    async index(): Promise<{ ids: string[]; shown: string; chats?: ChatSummary[] } | undefined> {
      try {
        const data = JSON.parse(await readFile(join(dir, 'ui-chats.json'), 'utf8'));
        if (
          valid(data.shown) &&
          Array.isArray(data.ids) &&
          data.ids.every(valid) &&
          (data.ids.includes(data.shown) || data.chats?.some((row: ChatSummary) => row?.chat === data.shown))
        )
          return data;
      } catch {
        /* Older installations have only the native session stores. */
      }
    },
  };
}
