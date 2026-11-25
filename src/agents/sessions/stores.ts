import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  activeIfRecent,
  ending,
  findFiles,
  headAndTail,
  homeOf,
  isRecord,
  mapLimited,
  oneLine,
  promptLine,
  readJson,
  select,
  timeOf,
  isAgentWorktree,
} from './files.js';
import { number, queryDatabase, tableColumns, text, type Row } from './sqlite.js';
import type { SessionTurn } from '../session.js';
import { transcriptBuilder, transcriptLines } from './transcript.js';
import type { SessionInfo, SessionReadOptions, SessionSource } from './types.js';

export interface StoreOptions {
  /** The agent's data directory, instead of its default place under the home directory. */
  dir?: string;
  env?: NodeJS.ProcessEnv;
}

/** Sessions enriched from their transcripts per listing, at most: the rest keep what the index says. */
const ENRICH = 200;

/** Rows of `table` with the `wanted` columns this version of the store has (others come back undefined). */
async function rows(file: string, table: string, wanted: readonly string[], tail = ''): Promise<Row[]> {
  const columns = await tableColumns(file, table);
  if (!columns?.size) return [];
  const present = wanted.filter((column) => columns.has(column));
  if (!present.length) return [];
  return (await queryDatabase(file, `SELECT ${present.join(', ')} FROM ${table} ${tail}`)) ?? [];
}

const title = (value: unknown) => {
  const found = text(value);
  return found ? oneLine(found, 120) : undefined;
};
const prompt = (value: unknown) => {
  const found = text(value);
  return found ? promptLine(found) : undefined;
};

/** Drop undefined fields, so sources can build sessions with plain object literals. */
function session(info: { [K in keyof SessionInfo]: SessionInfo[K] | undefined }): SessionInfo {
  return Object.fromEntries(Object.entries(info).filter(([, value]) => value !== undefined)) as unknown as SessionInfo;
}

/**
 * Muse Code: the `sessions` table of `~/.local/share/muse/session-index.db` (root sessions only;
 * subagents have their own rows).
 */
export function museSessions(options: StoreOptions = {}): SessionSource {
  return {
    name: 'muse',
    where: 'local',
    verified: '1.4.14',
    async list(query = {}) {
      const env = query.env ?? options.env ?? process.env;
      const dir = options.dir ?? path.join(env.XDG_DATA_HOME ?? path.join(homeOf(env), '.local', 'share'), 'muse');
      const found = await rows(path.join(dir, 'session-index.db'), 'sessions', [
        'session_id',
        'session_log_path',
        'workspace_root',
        'model_id',
        'git_branch',
        'title',
        'session_name',
        'first_user_prompt',
        'created_at_us',
        'updated_at_us',
        'msp_kind',
        'status',
        'msp_created_by_client_name',
        'provider_id',
      ]);
      return select(
        found
          .filter((row) => (row.msp_kind === undefined || row.msp_kind === 'root') && row.status !== 'corrupt')
          .flatMap((row) => {
            const id = text(row.session_id);
            const updated = number(row.updated_at_us) ?? number(row.created_at_us);
            if (!id || updated === undefined) return [];
            const updatedAt = Math.round(updated / 1000);
            const created = number(row.created_at_us);
            return [
              session({
                source: 'muse',
                agent: 'muse',
                id,
                where: 'local',
                cwd: text(row.workspace_root),
                branch: text(row.git_branch),
                title: title(row.session_name) ?? title(row.title),
                firstPrompt: prompt(row.first_user_prompt),
                lastPrompt: prompt(row.first_user_prompt),
                startedAt: created === undefined ? undefined : Math.round(created / 1000),
                updatedAt,
                model: text(row.model_id),
                path: text(row.session_log_path),
                // A probe of the agent, or its test provider: nobody's conversation.
                automated:
                  text(row.msp_created_by_client_name) === 'probe_client' || text(row.provider_id) === 'echo'
                    ? true
                    : undefined,
                ...activeIfRecent(updatedAt),
              }),
            ];
          }),
        query,
      );
    },
    async read(info, readOptions) {
      if (!info.path) throw new Error(`Muse names no log for session ${info.id}.`);
      return museTranscript(await transcriptLines(info.path, readOptions), readOptions);
    },
  };
}

/** The turns in the records of a Muse Code `session.jsonl`: the root run's prompts, messages and tool calls. */
export function museTranscript(lines: readonly unknown[], options: SessionReadOptions = {}): SessionTurn[] {
  const builder = transcriptBuilder('muse', options);
  // A call is known by two ids; results name either.
  const calls = new Map<string, string>();
  for (const line of lines) {
    const payload = isRecord(line) && isRecord(line.payload) ? line.payload : undefined;
    const event = payload && isRecord(payload.event) ? payload.event : undefined;
    if (!payload || !event || payload.kind !== 'run') continue;
    if (event.kind === 'started' && text(event.prompt)) builder.prompt(text(event.prompt)!);
    if (event.kind === 'assistant_message_committed' && text(event.text)) builder.text(text(event.text)!);
    if (event.kind === 'assistant_tool_calls_committed' && Array.isArray(event.tool_calls)) {
      for (const call of event.tool_calls) {
        if (!isRecord(call) || typeof call.name !== 'string') continue;
        const id = text(call.call_id) ?? text(call.id);
        for (const alias of [text(call.call_id), text(call.id)]) if (alias && id) calls.set(alias, id);
        builder.tool(id, call.name, jsonOr(call.args));
      }
    }
    if (event.kind === 'tool_result_batch_committed' && Array.isArray(event.results)) {
      for (const result of event.results) {
        if (!isRecord(result)) continue;
        builder.toolResult(calls.get(text(result.tool_call_id) ?? ''), text(result.text));
      }
    }
  }
  return builder.turns();
}

/** A JSON string's value, or the value as it is. */
function jsonOr(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** `2026-11-07 17:16:46.484148+00:00` as epoch milliseconds. */
function sqlTime(value: unknown): number | undefined {
  const found = text(value);
  return found ? timeOf(found.replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1')) : undefined;
}

function firstFileUri(value: unknown): string | undefined {
  try {
    const uris: unknown = JSON.parse(text(value) ?? '[]');
    const uri = Array.isArray(uris)
      ? uris.find((entry) => typeof entry === 'string' && entry.startsWith('file://'))
      : undefined;
    return typeof uri === 'string' ? fileURLToPath(uri) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Antigravity: `conversation_summaries.db` in `~/.gemini/antigravity` (shared with the desktop app)
 * and `~/.gemini/antigravity-cli`. Top-level conversations only.
 */
export function antigravitySessions(options: StoreOptions = {}): SessionSource {
  return {
    name: 'antigravity',
    where: 'local',
    verified: '1.5.3',
    async list(query = {}) {
      const env = query.env ?? options.env ?? process.env;
      const dirs = options.dir
        ? [options.dir]
        : ['antigravity', 'antigravity-cli'].map((name) => path.join(homeOf(env), '.gemini', name));
      const byId = new Map<string, SessionInfo>();
      for (const dir of dirs) {
        const found = await rows(path.join(dir, 'conversation_summaries.db'), 'conversation_summaries', [
          'conversation_id',
          'title',
          'preview',
          'last_modified_time',
          'last_user_input_time',
          'workspace_uris',
          'status',
          'nesting_depth',
          'parent_conversation_id',
          'source',
        ]);
        for (const row of found) {
          const id = text(row.conversation_id);
          const updatedAt = sqlTime(row.last_modified_time) ?? sqlTime(row.last_user_input_time);
          if (!id || updatedAt === undefined) continue;
          if ((number(row.nesting_depth) ?? 0) > 0 || text(row.parent_conversation_id)) continue;
          const known = byId.get(id);
          if (known && known.updatedAt >= updatedAt) continue;
          const status = text(row.status) ?? '';
          const cwd = firstFileUri(row.workspace_uris);
          const headless = text(row.source) === 'CORTEX_TRAJECTORY_SOURCE_CLI';
          byId.set(
            id,
            session({
              source: 'antigravity',
              agent: 'antigravity',
              id,
              where: 'local',
              cwd,
              // Started from the command line by a program, outside any project: a test or an agent's errand.
              // A CLI run in a project stays: it can be somebody's chat in an app built on genaicode.
              automated: headless && (!cwd || isAgentWorktree(cwd)) ? true : undefined,
              title: title(row.title) ?? title(row.preview),
              updatedAt,
              state: status.endsWith('_RUNNING') ? 'active' : status.endsWith('_IDLE') ? 'waiting' : undefined,
              path: path.join(dir, 'brain', id, '.system_generated', 'logs', 'transcript.jsonl'),
            }),
          );
        }
      }
      return select([...byId.values()], query);
    },
    async read(info, readOptions) {
      if (!info.path) throw new Error(`Session ${info.id} has no transcript file.`);
      return antigravityTranscript(await transcriptLines(info.path, readOptions), readOptions);
    },
  };
}

/**
 * The turns in the steps of an Antigravity `transcript.jsonl`. Tool calls carry no ids there: the
 * finished steps after a response are its calls' results, in order.
 */
export function antigravityTranscript(lines: readonly unknown[], options: SessionReadOptions = {}): SessionTurn[] {
  const builder = transcriptBuilder('antigravity', options);
  let waiting: string[] = [];
  let next = 0;
  for (const line of lines) {
    if (!isRecord(line)) continue;
    const at = timeOf(line.created_at);
    const content = text(line.content);
    if (line.type === 'USER_INPUT') {
      waiting = [];
      if (content) builder.prompt(content, at);
    } else if (line.type === 'PLANNER_RESPONSE') {
      waiting = [];
      if (content) builder.text(content, at);
      for (const call of Array.isArray(line.tool_calls) ? line.tool_calls : []) {
        if (!isRecord(call) || typeof call.name !== 'string') continue;
        const id = `step-${next++}`;
        waiting.push(id);
        builder.tool(id, call.name, call.args, at);
      }
    } else if (line.type === 'GENERIC' && (line.status === 'DONE' || line.status === 'ERROR')) {
      const id = waiting.shift();
      if (id) builder.toolResult(id, content ?? text(line.error), line.status === 'ERROR', at);
    }
  }
  return builder.turns();
}

/** The flat `key: value` lines of Copilot's `workspace.yaml`. */
function flatYaml(source: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of source.split('\n')) {
    const match = /^([A-Za-z_]\w*):\s*(.*)$/.exec(line);
    if (!match) continue;
    const raw = match[2]!.trim();
    values[match[1]!] = /^(".*"|'.*')$/.test(raw) ? raw.slice(1, -1) : raw;
  }
  return values;
}

/** GitHub Copilot CLI: `~/.copilot/session-state/<id>/workspace.yaml`, with `events.jsonl` where it exists. */
export function copilotSessions(options: StoreOptions = {}): SessionSource {
  return {
    name: 'copilot',
    where: 'local',
    verified: '1.0.88',
    async list(query = {}) {
      const env = query.env ?? options.env ?? process.env;
      const dir = options.dir ?? env.COPILOT_HOME ?? path.join(homeOf(env), '.copilot');
      const files = await findFiles(path.join(dir, 'session-state'), 1, (name) => name === 'workspace.yaml');
      // Sessions the CLI's index knows (it kept conversations there before it stopped writing event logs).
      let indexed: Promise<Set<string>> | undefined;
      const ids = (sql: string) =>
        queryDatabase(path.join(dir, 'session-store.db'), sql).then(
          (found) => (found ?? []).map((row) => String(row.id)),
          () => [],
        );
      const inIndex = async (id: string) =>
        (
          await (indexed ??= Promise.all([
            ids('SELECT id FROM sessions'),
            ids('SELECT DISTINCT session_id AS id FROM turns'),
          ]).then((lists) => new Set(lists.flat())))
        ).has(id);
      const found = await mapLimited(files, 16, async (file): Promise<SessionInfo | null> => {
        const meta = flatYaml(await fs.readFile(file.path, 'utf8').catch(() => ''));
        const folder = path.dirname(file.path);
        const id = meta.id || path.basename(folder);
        // A workspace with no event log that the index does not know either was opened and left
        // with nothing said (IDEs and ACP clients leave many): nothing to list or continue.
        const logged = await fs.stat(path.join(folder, 'events.jsonl')).then(
          () => true,
          () => false,
        );
        if (!logged && !(await inIndex(id))) return null;
        const updatedAt = timeOf(meta.updated_at) ?? file.mtimeMs;
        return session({
          source: 'copilot',
          agent: 'copilot',
          id,
          where: 'local',
          cwd: meta.cwd || undefined,
          repository: meta.repository || undefined,
          branch: meta.branch || undefined,
          title: title(meta.name),
          startedAt: timeOf(meta.created_at),
          updatedAt,
          path: path.join(folder, 'events.jsonl'),
          ...activeIfRecent(updatedAt),
        });
      });
      const chosen = select(
        found.filter((entry): entry is SessionInfo => entry !== null),
        query,
      );
      await mapLimited(chosen.slice(0, ENRICH), 8, (info) => copilotEvents(info));
      return chosen;
    },
    async read(info, readOptions) {
      // Newer CLIs write no event log: what was said may then be in the CLI's own index.
      const lines = info.path ? await transcriptLines(info.path, readOptions).catch(() => null) : null;
      if (lines) return copilotTranscript(lines, readOptions);
      // The index of the store the session was listed from: <store>/session-state/<id>/events.jsonl.
      const env = options.env ?? process.env;
      const dir = info.path
        ? path.resolve(info.path, '../../..')
        : (options.dir ?? env.COPILOT_HOME ?? path.join(homeOf(env), '.copilot'));
      const turns = await queryDatabase(
        path.join(dir, 'session-store.db'),
        'SELECT user_message, assistant_response, timestamp FROM turns WHERE session_id = ? ORDER BY turn_index',
        [info.id],
      ).catch(() => null);
      const builder = transcriptBuilder('copilot', readOptions);
      for (const turn of turns ?? []) {
        if (!text(turn.user_message)) continue;
        builder.prompt(text(turn.user_message)!, timeOf(turn.timestamp));
        if (text(turn.assistant_response)) builder.text(text(turn.assistant_response)!);
      }
      const found = builder.turns();
      if (!found.length) throw new Error(`Copilot keeps no readable conversation for session ${info.id}.`);
      return found;
    },
  };
}

/** The turns in the lines of a Copilot CLI `events.jsonl`. A subagent's traffic is left out. */
export function copilotTranscript(lines: readonly unknown[], options: SessionReadOptions = {}): SessionTurn[] {
  const builder = transcriptBuilder('copilot', options);
  for (const line of lines) {
    if (!isRecord(line) || !isRecord(line.data)) continue;
    if (typeof line.agentId === 'string' || typeof line.data.parentToolCallId === 'string') continue;
    const at = timeOf(line.timestamp);
    const content = text(line.data.content);
    if (line.type === 'user.message' && content) builder.prompt(content, at);
    if (line.type === 'assistant.message' && content) builder.text(content, at);
    if (line.type === 'tool.execution_start' && typeof line.data.toolName === 'string') {
      builder.tool(text(line.data.toolCallId), line.data.toolName, line.data.arguments, at);
    }
    if (line.type === 'tool.execution_complete') {
      const result = isRecord(line.data.result) ? text(line.data.result.content) : undefined;
      builder.toolResult(text(line.data.toolCallId), result, line.data.success === false, at);
    }
  }
  return builder.turns();
}

async function copilotEvents(info: SessionInfo): Promise<void> {
  if (!info.path) return;
  let stat;
  try {
    stat = await fs.stat(info.path);
  } catch {
    return;
  }
  const { head, tail } = await headAndTail({ path: info.path, mtimeMs: stat.mtimeMs, size: stat.size });
  let agentLast = false;
  const scan = (lines: unknown[], first: boolean) => {
    for (const line of lines) {
      if (!isRecord(line) || !isRecord(line.data)) continue;
      // A subagent's traffic (envelope `agentId`; older CLIs: `data.parentToolCallId`) is not the conversation.
      if (typeof line.agentId === 'string' || typeof line.data.parentToolCallId === 'string') continue;
      const content = text(line.data.content);
      if (line.type === 'user.message' && content) {
        if (first) info.firstPrompt ??= promptLine(content);
        info.lastPrompt = promptLine(content);
        agentLast = false;
      }
      if (line.type === 'assistant.message') {
        if (content) info.lastReply = ending(content);
        info.model = text(line.data.model) ?? info.model;
        agentLast = !!content;
      }
      if (line.type === 'session.model_change') info.model = text(line.data.newModel) ?? info.model;
      if (line.type === 'tool.execution_start') agentLast = false;
      if (line.type === 'session.task_complete' || line.type === 'session.shutdown') agentLast = true;
    }
  };
  scan(head, true);
  scan(tail, false);
  if (info.state !== 'active') info.state = agentLast ? 'waiting' : 'unfinished';
}

/** Cursor agent CLI: `~/.cursor/chats/<md5 of cwd>/<id>/meta.json`. */
export function cursorSessions(options: StoreOptions = {}): SessionSource {
  return {
    name: 'cursor',
    where: 'local',
    verified: '2026.10.22',
    async list(query = {}) {
      const env = query.env ?? options.env ?? process.env;
      const dir = options.dir ?? path.join(homeOf(env), '.cursor');
      const files = await findFiles(path.join(dir, 'chats'), 2, (name) => name === 'meta.json');
      const found = await mapLimited(files, 16, async (file): Promise<SessionInfo | null> => {
        const meta = await readJson(file.path);
        if (!isRecord(meta) || meta.hasConversation === false) return null;
        const updatedAt = number(meta.updatedAtMs) ?? file.mtimeMs;
        return session({
          source: 'cursor',
          agent: 'cursor',
          id: path.basename(path.dirname(file.path)),
          where: 'local',
          cwd: text(meta.cwd),
          title: title(meta.title),
          startedAt: number(meta.createdAtMs),
          updatedAt,
          path: path.join(path.dirname(file.path), 'store.db'),
          ...activeIfRecent(updatedAt),
        });
      });
      const chosen = select(
        found.filter((entry): entry is SessionInfo => entry !== null),
        query,
      );
      // The model is in the chat's own database, as hex-encoded JSON (next to a key we do not read out).
      await mapLimited(chosen.slice(0, ENRICH), 4, async (info) => {
        try {
          const [row] = (await queryDatabase(info.path!, "SELECT value FROM meta WHERE key = '0'")) ?? [];
          const meta: unknown = JSON.parse(Buffer.from(text(row?.value) ?? '', 'hex').toString('utf8'));
          if (isRecord(meta)) info.model = text(meta.lastUsedModel);
        } catch {
          // No database yet, or a layout this reader does not know.
        }
      });
      return chosen;
    },
  };
}

/** Mistral Vibe: `meta.json` in each `~/.vibe/logs/session/session_...` folder (`VIBE_HOME`). */
export function vibeSessions(options: StoreOptions = {}): SessionSource {
  return {
    name: 'vibe',
    where: 'local',
    verified: '2.25',
    async list(query = {}) {
      const env = query.env ?? options.env ?? process.env;
      const dir = options.dir ?? env.VIBE_HOME ?? path.join(homeOf(env), '.vibe');
      const files = await findFiles(path.join(dir, 'logs', 'session'), 1, (name) => name === 'meta.json');
      const found = await mapLimited(files, 16, async (file): Promise<SessionInfo | null> => {
        const meta = await readJson(file.path);
        if (!isRecord(meta) || !text(meta.session_id)) return null;
        const stats = isRecord(meta.stats) ? meta.stats : {};
        const input = number(stats.session_prompt_tokens);
        const output = number(stats.session_completion_tokens);
        const cached = number(stats.session_cached_tokens);
        const total = number(stats.session_total_llm_tokens);
        const updatedAt = Math.max(timeOf(meta.end_time) ?? 0, file.mtimeMs);
        return session({
          source: 'vibe',
          agent: 'vibe',
          id: text(meta.session_id)!,
          where: 'local',
          cwd: isRecord(meta.environment) ? text(meta.environment.working_directory) : undefined,
          branch: text(meta.git_branch),
          title: title(meta.title),
          startedAt: timeOf(meta.start_time),
          updatedAt,
          usage:
            input === undefined && output === undefined && total === undefined
              ? undefined
              : {
                  ...(input !== undefined ? { inputTokens: input } : {}),
                  ...(output !== undefined ? { outputTokens: output } : {}),
                  ...(cached !== undefined ? { cachedInputTokens: cached } : {}),
                  ...(total !== undefined ? { totalTokens: total } : {}),
                },
          costUsd: number(stats.session_cost),
          path: path.join(path.dirname(file.path), 'messages.jsonl'),
          ...activeIfRecent(updatedAt),
        });
      });
      return select(
        found.filter((entry): entry is SessionInfo => entry !== null),
        query,
      );
    },
    async read(info, readOptions) {
      if (!info.path) throw new Error(`Session ${info.id} has no messages file.`);
      return vibeTranscript(await transcriptLines(info.path, readOptions), readOptions);
    },
  };
}

/** The turns in the lines of a Vibe `messages.jsonl`. Messages Vibe injected itself are not prompts. */
export function vibeTranscript(lines: readonly unknown[], options: SessionReadOptions = {}): SessionTurn[] {
  const builder = transcriptBuilder('vibe', options);
  for (const line of lines) {
    if (!isRecord(line)) continue;
    const content = text(line.content);
    if (line.role === 'user' && line.injected !== true && content) builder.prompt(content);
    if (line.role === 'assistant') {
      if (content) builder.text(content);
      for (const call of Array.isArray(line.tool_calls) ? line.tool_calls : []) {
        if (!isRecord(call) || !isRecord(call.function) || typeof call.function.name !== 'string') continue;
        builder.tool(text(call.id), call.function.name, jsonOr(call.function.arguments));
      }
    }
    if (line.role === 'tool') builder.toolResult(text(line.tool_call_id), content);
  }
  return builder.turns();
}

/** Gemini CLI: the `session-...jsonl` files in `~/.gemini/tmp/<project>/chats`; `.project_root` beside `chats` names the directory. */
export function geminiSessions(options: StoreOptions = {}): SessionSource {
  return {
    name: 'gemini',
    where: 'local',
    async list(query = {}) {
      const env = query.env ?? options.env ?? process.env;
      const dir = options.dir ?? path.join(env.GEMINI_CLI_HOME ?? homeOf(env), '.gemini');
      const files = (
        await findFiles(path.join(dir, 'tmp'), 2, (name) => name.startsWith('session-') && name.endsWith('.jsonl'))
      ).filter((file) => path.basename(path.dirname(file.path)) === 'chats');
      const roots = new Map<string, Promise<string | undefined>>();
      const rootOf = (project: string) => {
        let root = roots.get(project);
        if (!root) {
          root = fs.readFile(path.join(project, '.project_root'), 'utf8').then(
            (value) => value.trim() || undefined,
            () => undefined,
          );
          roots.set(project, root);
        }
        return root;
      };
      const found = await mapLimited(files, 8, async (file): Promise<SessionInfo | null> => {
        const { head, tail } = await headAndTail(file).catch(() => ({ head: [], tail: [] }));
        const info: SessionInfo = {
          source: 'gemini',
          agent: 'gemini',
          id: '',
          where: 'local',
          updatedAt: file.mtimeMs,
          path: file.path,
        };
        let agentLast = false;
        const scan = (lines: unknown[], first: boolean) => {
          for (const line of lines) {
            if (!isRecord(line)) continue;
            if (typeof line.sessionId === 'string') {
              // Subagent chats are files of their own, with another `kind`.
              if (line.kind !== undefined && line.kind !== 'main') info.id = '';
              else info.id = line.sessionId;
              info.startedAt = timeOf(line.startTime) ?? info.startedAt;
            }
            if (line.type === 'user' && Array.isArray(line.content)) {
              const said = line.content
                .flatMap((part) => (isRecord(part) && typeof part.text === 'string' ? [part.text] : []))
                .join('\n')
                .trim();
              if (said) {
                if (first) info.firstPrompt ??= promptLine(said);
                info.lastPrompt = promptLine(said);
                agentLast = false;
              }
            }
            if (line.type === 'gemini') {
              const reply = text(line.content);
              if (reply) info.lastReply = ending(reply);
              info.model = text(line.model) ?? info.model;
              agentLast = !!reply;
            }
          }
        };
        scan(head, true);
        scan(tail, false);
        if (!info.id) return null;
        const cwd = await rootOf(path.dirname(path.dirname(file.path)));
        if (cwd) info.cwd = cwd;
        info.state = activeIfRecent(file.mtimeMs).state ?? (agentLast ? 'waiting' : 'unfinished');
        return info;
      });
      return select(
        found.filter((entry): entry is SessionInfo => entry !== null),
        query,
      );
    },
    async read(info, readOptions) {
      if (!info.path) throw new Error(`Session ${info.id} has no chat file.`);
      return geminiTranscript(await transcriptLines(info.path, readOptions), readOptions);
    },
  };
}

/** The turns in the lines of a Gemini CLI chat file: what the user and the model said. */
export function geminiTranscript(lines: readonly unknown[], options: SessionReadOptions = {}): SessionTurn[] {
  const builder = transcriptBuilder('gemini', options);
  for (const line of lines) {
    if (!isRecord(line)) continue;
    const at = timeOf(line.timestamp);
    if (line.type === 'user' && Array.isArray(line.content)) {
      const said = line.content
        .flatMap((part) => (isRecord(part) && typeof part.text === 'string' ? [part.text] : []))
        .join('\n')
        .trim();
      if (said) builder.prompt(said, at);
    }
    if (line.type === 'gemini') {
      const reply = text(line.content);
      if (reply) builder.text(reply, at);
    }
  }
  return builder.turns();
}
