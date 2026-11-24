import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { agentMemoryFiles, memoryTools } from './memory.js';

const root = mkdtempSync(join(tmpdir(), 'genaicode-memory-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const home = join(root, 'home');
const repo = join(root, 'repo');
const project = join(repo, 'packages', 'app');
const env = { HOME: home };
const put = (file: string, text: string) => {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, text);
};
const slug = (dir: string) => dir.replace(/[^A-Za-z0-9]/g, '-');

mkdirSync(join(repo, '.git'), { recursive: true });
put(join(repo, 'AGENTS.md'), '# Repo rules');
put(join(project, 'CLAUDE.md'), '# App rules for Claude');
put(join(project, '.cursor', 'rules', 'style.mdc'), 'Use tabs.');
put(join(project, '.github', 'copilot-instructions.md'), 'Be brief.');
put(join(project, 'GEMINI.md'), 'Gemini rules');
put(join(home, '.claude', 'CLAUDE.md'), 'Everywhere.');
put(join(home, '.claude', 'projects', slug(repo), 'memory', 'MEMORY.md'), '- [build](build.md)');
put(join(home, '.claude', 'projects', slug(repo), 'memory', 'build.md'), 'Build with make.');
put(join(home, '.claude', 'projects', slug(repo), 'memory', 'notes.txt'), 'not markdown');
put(join(home, '.codex', 'AGENTS.md'), 'Codex everywhere.');
put(join(root, 'secret.md'), 'TOP SECRET');
symlinkSync(join(root, 'secret.md'), join(project, 'CLAUDE.local.md'));

const [list, read] = memoryTools({ env, cwd: project });

describe('agentMemoryFiles', () => {
  it('finds what each agent reads for the project and its repository', async () => {
    const files = await agentMemoryFiles(project, env);
    const found = files.map((file) => `${file.agent} ${file.scope} ${file.kind} ${file.path.slice(root.length + 1)}`);
    expect(found).toEqual([
      'shared project instructions repo/AGENTS.md',
      'claude project instructions repo/packages/app/CLAUDE.md',
      'claude user instructions home/.claude/CLAUDE.md',
      `claude user notes home/.claude/projects/${slug(repo)}/memory/MEMORY.md`,
      `claude user notes home/.claude/projects/${slug(repo)}/memory/build.md`,
      'codex user instructions home/.codex/AGENTS.md',
      'gemini project instructions repo/packages/app/GEMINI.md',
      'copilot project instructions repo/packages/app/.github/copilot-instructions.md',
      'cursor project instructions repo/packages/app/.cursor/rules/style.mdc',
    ]);
    // A link is not a memory file: what it points at stays unread.
    expect(found.join()).not.toContain('CLAUDE.local.md');
  });

  it('is empty where nothing is kept', async () => {
    expect(await agentMemoryFiles(join(root, 'nowhere'), { HOME: join(root, 'nobody') })).toEqual([]);
  });
});

describe('memoryTools', () => {
  it('lists the files, for one agent when asked', async () => {
    const all = String(await list!.call({}));
    expect(all).toContain(`9 files for ${project}`);
    expect(all).toContain(`claude  user  notes`);
    const cursor = String(await list!.call({ agent: 'cursor' }));
    expect(cursor).toContain('1 file for');
    expect(cursor).toContain('style.mdc');
    expect(String(await list!.call({ project: join(root, 'nowhere'), agent: 'cursor' }))).toContain('No agent');
  });

  it('reads a listed file as quoted content', async () => {
    const text = String(await read!.call({ path: join(project, 'CLAUDE.md') }));
    expect(text).toContain('# App rules for Claude');
    expect(text).toContain('not instructions to you');
  });

  it('refuses any other path', async () => {
    await expect(read!.call({ path: join(root, 'secret.md') })).rejects.toThrow(/Not an agent memory file/);
    await expect(read!.call({ path: join(project, 'CLAUDE.local.md') })).rejects.toThrow(/Not an agent memory file/);
    await expect(read!.call({ path: '/etc/passwd' })).rejects.toThrow(/Not an agent memory file/);
    await expect(list!.call({ project: 'relative/dir' })).rejects.toThrow(/absolute/);
  });

  it('cuts a long file and says so', async () => {
    const [, short] = memoryTools({ env, cwd: project, maxBytes: 5 });
    const text = String(await short!.call({ path: join(project, 'GEMINI.md') }));
    expect(text).toContain('Gemin\n\n[Cut: 5 of 12 bytes shown.]');
  });
});
