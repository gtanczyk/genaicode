import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { projectTeams, readPackProfile } from './pack-profile.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
const choices = ['one', 'two', 'three'].map((name) => ({ name, installed: true, canLead: name !== 'three' }));
const team = { lead: 'one', members: ['two', 'three'] };
async function fixture() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), 'genaicode-profile-')));
  roots.push(root);
  const project = path.join(root, 'project');
  execFileSync('git', ['init', '-q', project]);
  const folder = path.join(project, 'src');
  await fs.mkdir(folder);
  return { root, project, folder, profiles: projectTeams(choices, { HOME: root }) };
}

it('round trips at the project root across work in subdirectories and concurrent saves', async () => {
  const { root, project, folder, profiles } = await fixture();
  expect(await profiles.load(folder)).toMatchObject({ project, saved: false });
  expect(await fs.readdir(project)).not.toContain('.genaicode');
  const other = { lead: 'two', members: ['one'] };
  await Promise.all([profiles.save(folder, team), profiles.save(project, other)]);
  expect([team, other]).toContainEqual(await readPackProfile(project));
  expect(await fs.readdir(path.join(project, '.genaicode'))).toEqual(['pack.json']);
  const otherDir = path.join(root, 'other');
  await fs.mkdir(otherDir);
  expect(await profiles.load(otherDir)).toMatchObject({ saved: false });
  await expect(profiles.save(root, team)).rejects.toThrow('project folder');
  await expect(profiles.save(folder, { lead: 'three', members: ['one'] })).rejects.toThrow('cannot lead');
});

it('reports an unavailable member and refuses a linked settings directory', async () => {
  const { root, project, profiles } = await fixture();
  await profiles.save(project, team);
  const file = path.join(project, '.genaicode', 'pack.json');
  await fs.writeFile(file, JSON.stringify({ lead: 'one', members: ['missing'] }));
  expect((await profiles.load(project)).problem).toContain('"missing"');
  await fs.rename(path.dirname(file), path.join(root, 'previous'));
  await fs.symlink(path.join(root, 'previous'), path.dirname(file), 'dir');
  await expect(profiles.save(project, team)).rejects.toThrow('real .genaicode directory');
});
