import { randomUUID } from 'node:crypto';
import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import { detectAgents } from './discovery.js';
import { repoRoot } from './pack-git.js';
import { homeOf, isRecord } from './sessions/files.js';
import type { CodingAgent } from './types.js';

export interface PackProfile {
  lead: string;
  members: string[];
}

export interface ProfileChoice {
  name: string;
  installed: boolean;
  canLead: boolean;
}

export interface ProjectTeam {
  project: string;
  team?: PackProfile;
  choices: ProfileChoice[];
  saved: boolean;
  problem?: string;
}

export const PROFILE_PATH = '.genaicode/pack.json';
const MAX_BYTES = 16 * 1024;
const absent = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT';

export function parsePackProfile(value: unknown): PackProfile {
  const name = (text: unknown): text is string => typeof text === 'string' && /^[\w.-]{1,80}$/.test(text);
  if (
    !isRecord(value) ||
    !name(value.lead) ||
    !Array.isArray(value.members) ||
    value.members.length === 0 ||
    value.members.length > 100 ||
    !value.members.every(name)
  )
    throw new Error(`${PROFILE_PATH} needs a lead and a non-empty list of member names.`);
  return { lead: value.lead, members: [...new Set(value.members)] };
}

/** The worktree root, or the project directory itself outside Git. */
export async function packRoot(cwd: string): Promise<string> {
  return (await repoRoot(cwd)) ?? path.resolve(cwd);
}

async function profileDirectory(root: string, create = false): Promise<string | undefined> {
  const dir = path.join(root, '.genaicode');
  if (create)
    await fs.mkdir(dir, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });
  const stat = await fs.lstat(dir).catch((error: unknown) => {
    if (!absent(error)) throw error;
  });
  if (!stat) return undefined;
  if (!stat.isDirectory()) throw new Error(`${PROFILE_PATH} needs a real .genaicode directory.`);
  return dir;
}

async function profileFile(dir: string) {
  const file = path.join(dir, 'pack.json');
  const stat = await fs.lstat(file).catch((error: unknown) => {
    if (!absent(error)) throw error;
  });
  if (stat && !stat.isFile()) throw new Error(`${PROFILE_PATH} must be a regular file.`);
  return stat ? file : undefined;
}

export async function readPackProfile(root: string): Promise<PackProfile | undefined> {
  const dir = await profileDirectory(root);
  const file = dir && (await profileFile(dir));
  if (!file) return undefined;
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error(`Invalid or oversized ${PROFILE_PATH}.`);
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const part = await handle.read(buffer, bytesRead, buffer.length - bytesRead);
      if (!part.bytesRead) break;
      bytesRead += part.bytesRead;
    }
    if (bytesRead > MAX_BYTES) throw new Error(`Oversized ${PROFILE_PATH}.`);
    let data: unknown;
    try {
      data = JSON.parse(buffer.toString('utf8', 0, bytesRead));
    } catch {
      throw new Error(`Invalid JSON in ${PROFILE_PATH}.`);
    }
    return parsePackProfile(data);
  } finally {
    await handle.close();
  }
}

export function profileChoices(agents: readonly CodingAgent[], env: NodeJS.ProcessEnv): ProfileChoice[] {
  return detectAgents(agents, env).map(({ agent, path }) => ({
    name: agent.name,
    installed: path !== null,
    canLead: !!agent.capabilities.mcp,
  }));
}

export function validateTeam(team: PackProfile, choices: readonly ProfileChoice[]): void {
  for (const name of [team.lead, ...team.members]) {
    const choice = choices.find((c) => c.name === name);
    if (!choice?.installed) throw new Error(`Agent "${name}" in ${PROFILE_PATH} is unknown or not installed.`);
    if (name === team.lead && !choice.canLead)
      throw new Error(`Agent "${name}" cannot lead a pack without MCP support.`);
  }
}

export interface ProjectTeams {
  load(cwd: string): Promise<ProjectTeam>;
  save(cwd: string, value: unknown): Promise<void>;
}

/** Only the standalone operator UI gets these methods, never an agent or an embedded page. */
export function projectTeams(choices: ProfileChoice[], env: NodeJS.ProcessEnv, current?: PackProfile): ProjectTeams {
  const checkedRoot = async (cwd: string) => {
    if (!path.isAbsolute(cwd)) throw new Error('Choose an absolute project folder.');
    const project = await fs.realpath(await packRoot(await fs.realpath(cwd)));
    const home = await fs.realpath(homeOf(env)).catch(() => path.resolve(homeOf(env)));
    const appHome = await fs
      .realpath(env.GENAICODE_HOME ?? path.join(home, '.genaicode'))
      .catch(() => path.resolve(env.GENAICODE_HOME ?? path.join(home, '.genaicode')));
    if (
      project === path.parse(project).root ||
      project === home ||
      project === appHome ||
      project === path.join(appHome, 'home') ||
      !(await fs.stat(project)).isDirectory()
    )
      throw new Error('Choose a project folder to remember its team.');
    return project;
  };
  return {
    async load(cwd) {
      const project = await checkedRoot(cwd);
      let saved: PackProfile | undefined;
      let problem: string | undefined;
      try {
        saved = await readPackProfile(project);
        if (saved) validateTeam(saved, choices);
      } catch (error) {
        problem = error instanceof Error ? error.message : 'Could not read the saved team.';
      }
      const installed = choices.filter((c) => c.installed);
      const lead = installed.find((c) => c.canLead);
      const team = current ?? saved ?? (lead && { lead: lead.name, members: installed.map((c) => c.name) });
      return { project, choices, team, saved: !!saved, ...(problem ? { problem } : {}) };
    },
    async save(cwd, value) {
      const team = parsePackProfile(value);
      validateTeam(team, choices);
      const root = await checkedRoot(cwd);
      const dir = (await profileDirectory(root, true))!;
      await profileFile(dir);
      const temp = path.join(dir, `.pack-${randomUUID()}.tmp`);
      const handle = await fs.open(temp, 'wx', 0o600);
      try {
        try {
          await handle.writeFile(`${JSON.stringify(team, null, 2)}\n`);
        } finally {
          await handle.close();
        }
        await fs.rename(temp, path.join(dir, 'pack.json'));
        current = undefined;
      } finally {
        await fs.rm(temp, { force: true });
      }
    },
  };
}
