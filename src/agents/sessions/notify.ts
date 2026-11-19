import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { LiveAsk, LiveRecord } from './live.js';
import { liveDir } from './live.js';

/** What `genaicode notify` tells you about, as kept in `~/.genaicode/notify.json`. */
export interface NotifySettings {
  /** A session asks whether it may use a tool. */
  approval: boolean;
  /** A session finished its turn: the next move is yours. */
  done: boolean;
}

export interface Notice {
  title: string;
  body: string;
}

const OFF: NotifySettings = { approval: false, done: false };

/** Where the settings are kept: beside the hooks' reports. */
export function notifyFile(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(path.dirname(liveDir(env)), 'notify.json');
}

/** The settings; all off when none were saved or the file cannot be read. */
export async function readNotify(env: NodeJS.ProcessEnv = process.env): Promise<NotifySettings> {
  try {
    const saved = JSON.parse(await fs.readFile(notifyFile(env), 'utf8')) as Partial<NotifySettings>;
    return { approval: saved.approval === true, done: saved.done === true };
  } catch {
    return { ...OFF };
  }
}

export async function writeNotify(settings: NotifySettings, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const file = notifyFile(env);
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.writeFile(file, `${JSON.stringify(settings)}\n`, { mode: 0o600 });
}

/**
 * The notice a change of a session's record is worth, under `settings`: a question asked that was
 * not asked before, or a turn that ended. Only the agent, the project's directory name and the
 * tool: nothing of what was said.
 */
export function noticeFor(
  before: LiveRecord | undefined,
  after: LiveRecord,
  settings: NotifySettings,
): Notice | undefined {
  const project = after.cwd ? path.basename(after.cwd) || after.cwd : 'a session';
  if (after.state === 'approval' && settings.approval) {
    const known = new Set(before?.state === 'approval' ? (before.asks ?? [{}]).map(askId) : []);
    // A reminder of a question already known, or one more hook about it, is no news.
    const fresh = (after.asks ?? [{}]).filter((ask) => !known.has(askId(ask)));
    if (!fresh.length) return undefined;
    const tool = [...fresh].reverse().find((ask) => ask.tool)?.tool;
    return { title: `${after.agent} asks for approval`, body: `${project}: ${tool ?? 'a tool'}` };
  }
  if (after.state === 'idle' && settings.done && (before?.state === 'working' || before?.state === 'approval')) {
    return { title: `${after.agent} finished its turn`, body: `${project}: your move` };
  }
  return undefined;
}

/** A question's identity: the tool and what it was asked to do. */
function askId(ask: LiveAsk): string {
  return JSON.stringify([ask.tool ?? null, ask.key ?? null]);
}

export interface SendOptions {
  platform?: NodeJS.Platform;
  /** Runs the notifier. Default: `child_process.spawn`, detached, so a hook does not wait for it. */
  run?(command: string, args: string[]): void;
}

/**
 * Show `notice` as a desktop notification: Notification Center on macOS (`osascript`), the
 * desktop's notifications on Linux (`notify-send`). Text goes as arguments, never through a
 * shell or a script. Resolves to whether this platform can show one.
 */
export function sendNotice(notice: Notice, options: SendOptions = {}): boolean {
  const platform = options.platform ?? process.platform;
  const run =
    options.run ??
    ((command: string, args: string[]) => {
      const child = spawn(command, args, { detached: true, stdio: 'ignore' });
      child.on('error', () => undefined);
      child.unref();
    });
  if (platform === 'darwin') {
    run('osascript', [
      '-e',
      'on run argv',
      '-e',
      'display notification (item 2 of argv) with title (item 1 of argv)',
      '-e',
      'end run',
      notice.title,
      notice.body,
    ]);
    return true;
  }
  if (platform === 'linux') {
    run('notify-send', ['--app-name=genaicode', '--', notice.title, notice.body]);
    return true;
  }
  return false;
}
