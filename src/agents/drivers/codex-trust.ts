import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { homeOf, isWithin } from '../sessions/files.js';

export type CodexTrustLevel = 'trusted' | 'untrusted';

/** Path to Codex's user config (`$CODEX_HOME/config.toml`, else `~/.codex/config.toml`). */
export function codexConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const dir = env.CODEX_HOME ?? path.join(homeOf(env), '.codex');
  return path.join(dir, 'config.toml');
}

/**
 * Parse `[projects."<path>"]` trust entries from Codex's `config.toml`.
 * Returns a map from configured project path to `'trusted' | 'untrusted'`.
 */
export function parseCodexProjectTrust(toml: string): Map<string, CodexTrustLevel> {
  const entries = new Map<string, CodexTrustLevel>();
  let currentProject: string | undefined;

  for (const rawLine of toml.split(/\r?\n/)) {
    const line = stripComment(rawLine).trim();
    if (!line) continue;

    if (line.startsWith('[')) {
      currentProject = parseProjectSectionHeader(line);
      continue;
    }

    if (currentProject !== undefined) {
      const match = /^trust_level\s*=\s*(?:"(trusted|untrusted)"|'(trusted|untrusted)')\s*$/.exec(line);
      const level = (match?.[1] ?? match?.[2]) as CodexTrustLevel | undefined;
      if (level) entries.set(currentProject, level);
    }
  }
  return entries;
}

/**
 * Effective Codex trust level for `cwd` as recorded in `config.toml`, checking exact matches
 * and ancestor project roots (deepest match wins). Undefined when Codex has no decision for `cwd`.
 */
export function readCodexProjectTrust(cwd: string, env: NodeJS.ProcessEnv = process.env): CodexTrustLevel | undefined {
  const file = codexConfigPath(env);
  if (!existsSync(file)) return undefined;
  let content: string;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
  const entries = parseCodexProjectTrust(content);
  if (!entries.size) return undefined;

  const candidates = uniquePaths(cwd);
  let best: { depth: number; level: CodexTrustLevel } | undefined;
  for (const [configured, level] of entries) {
    for (const root of uniquePaths(configured)) {
      for (const candidate of candidates) {
        if (isWithin(candidate, root) && root.length >= (best?.depth ?? 0)) {
          best = { depth: root.length, level };
        }
      }
    }
  }
  return best?.level;
}

/**
 * Record `[projects."<path>"] trust_level = "<level>"` in Codex's `config.toml`, preserving
 * existing entries and comments. Used as a fallback when `config/value/write` is unavailable.
 */
export function writeCodexProjectTrust(
  cwd: string,
  level: CodexTrustLevel,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const target = canonicalPath(cwd);
  const file = codexConfigPath(env);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const existing = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const updated = upsertTrustInToml(existing, target, level);
  const tmp = `${file}.${process.pid}.${Math.random().toString(16).slice(2, 8)}.tmp`;
  writeFileSync(tmp, updated, { mode: 0o600 });
  renameSync(tmp, file);
}

/** Whether an error from Codex indicates that the working directory is not trusted. */
export function isCodexTrustError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /\b(untrusted|not inside a trusted|trust_level|trust this directory|trusted project)\b/i.test(message);
}

/** Canonical path for a Codex project entry (follows symlinks when the directory exists). */
export function canonicalPath(cwd: string): string {
  try {
    return realpathSync(cwd);
  } catch {
    return path.resolve(cwd);
  }
}

function uniquePaths(dir: string): string[] {
  const resolved = path.resolve(dir);
  const real = canonicalPath(dir);
  return real === resolved ? [resolved] : [resolved, real];
}

function parseProjectSectionHeader(line: string): string | undefined {
  if (!line.startsWith('[') || !line.endsWith(']') || line.startsWith('[[')) return undefined;
  const inner = line.slice(1, -1).trim();
  if (!inner.startsWith('projects.')) return undefined;
  const rest = inner.slice('projects.'.length).trim();
  if (rest.startsWith('"') && rest.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(rest);
      return typeof parsed === 'string' && parsed ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  if (rest.startsWith("'") && rest.endsWith("'") && rest.length >= 2) {
    return rest.slice(1, -1);
  }
  return /^[A-Za-z0-9_-]+$/.test(rest) ? rest : undefined;
}

function stripComment(line: string): string {
  let quote: '"' | "'" | undefined;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (quote === '"') {
      if (ch === '\\') i += 1;
      else if (ch === '"') quote = undefined;
    } else if (quote === "'") {
      if (ch === "'") quote = undefined;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '#') {
      return line.slice(0, i);
    }
  }
  return line;
}

function upsertTrustInToml(existing: string, target: string, level: CodexTrustLevel): string {
  const lines = existing ? existing.split(/\r?\n/) : [];
  let inTarget = false;
  let sectionStart = -1;
  let sectionEnd = lines.length;
  let trustLine = -1;

  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = stripComment(lines[i]!).trim();
    if (trimmed.startsWith('[')) {
      if (inTarget) {
        sectionEnd = i;
        break;
      }
      const sectionPath = parseProjectSectionHeader(trimmed);
      if (sectionPath !== undefined && uniquePaths(sectionPath).includes(target)) {
        inTarget = true;
        sectionStart = i;
      }
    } else if (inTarget && /^trust_level\s*=/.test(trimmed)) {
      trustLine = i;
    }
  }

  const assignment = `trust_level = ${JSON.stringify(level)}`;
  if (sectionStart >= 0) {
    if (trustLine >= 0) lines[trustLine] = assignment;
    else lines.splice(sectionEnd, 0, assignment);
    return `${lines.join('\n').replace(/\n*$/, '')}\n`;
  }

  const prefix = existing.trimEnd();
  const block = `[projects.${JSON.stringify(target)}]\n${assignment}\n`;
  return prefix ? `${prefix}\n\n${block}` : block;
}
