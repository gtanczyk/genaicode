import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import { antigravityTranscript } from '../agents/sessions/stores.js';
import type { SessionInfo } from '../agents/sessions/types.js';
import { sessionDocuments } from './session-documents.js';
import { storedConversation } from './transcript.js';

it('shows the person’s message, successful edits and the gallery of this Antigravity session', () => {
  const home = mkdtempSync(join(tmpdir(), 'thread-doc-'));
  try {
    const root = join(home, '.gemini', 'antigravity', 'brain', 'demo');
    mkdirSync(root, { recursive: true });
    const session: SessionInfo = {
      agent: 'antigravity',
      source: 'antigravity',
      id: 'demo',
      where: 'local',
      updatedAt: 0,
      path: join(root, '.system_generated', 'logs', 'transcript.jsonl'),
    };
    writeFileSync(
      join(root, 'gallery.md'),
      '# Battle gallery\n![Camp](camp.png)\n[Replay](clip.mp4)\n[Outside](outside.png)',
    );
    writeFileSync(join(root, 'camp.png'), 'raster');
    writeFileSync(join(root, 'clip.mp4'), 'movie');
    writeFileSync(join(home, 'outside.png'), 'private');
    if (process.platform !== 'win32') symlinkSync(join(home, 'outside.png'), join(root, 'outside.png'));
    const turns = antigravityTranscript([
      {
        type: 'USER_INPUT',
        content:
          '<USER_REQUEST>\nFirst line.\nSecond line.\n</USER_REQUEST>\n<ADDITIONAL_METADATA>clock</ADDITIONAL_METADATA>',
      },
      {
        type: 'PLANNER_RESPONSE',
        tool_calls: [
          { name: 'write_to_file', args: { TargetFile: '/work/a.ts' } },
          { name: 'replace_file_content', args: { TargetFile: '/work/b.ts' } },
        ],
      },
      { type: 'GENERIC', status: 'DONE', content: 'saved' },
      { type: 'GENERIC', status: 'ERROR', error: 'not saved' },
      {
        type: 'PLANNER_RESPONSE',
        content: `Review [gallery.md](${pathToFileURL(join(root, 'gallery.md'))}) and [missing](./missing.md).`,
      },
    ]);
    expect(turns[0]!.prompt).toBe('First line.\nSecond line.');
    expect(turns[0]!.entries.at(-1)).toEqual({ kind: 'files', paths: ['/work/a.ts'] });
    const conversation = storedConversation({ session, turns, readable: true });
    expect(conversation.turns[0]!.parts[1]?.summary).toBe('2 tool calls · 1 failed');
    const store = sessionDocuments({ HOME: home });
    const [doc] = store.read(session, conversation.turns);
    expect(doc?.title).toBe('Battle gallery');
    expect(doc?.mentions).toEqual([{ turn: 1, part: 2 }]);
    expect(doc?.media.map((m) => [m.label, m.video])).toEqual([
      ['Camp', false],
      ['Replay', true],
    ]);
    const id = doc!.media[1]!.url.slice('/files/'.length);
    expect(store.fromCapability(id)?.filename).toBe('clip.mp4');
    expect(store.read({ ...session, id: 'other' }, conversation.turns)).toEqual([]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
