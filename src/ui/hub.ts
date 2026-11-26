import { randomUUID } from 'node:crypto';
import { isArchived } from '../agents/sessions/archive.js';
import type { SessionInfo } from '../agents/sessions/types.js';
import type { ChatController, ChatSwitch, ChatView, SwitchOrder } from './controller.js';
import type { ProjectFiles } from './files.js';
import type { Uploads } from './uploads.js';

export interface HubChat {
  interrupted?: boolean;
  controller: ChatController;
  addRoot?(dir: string): void;
  files: ProjectFiles;
  uploads: Uploads;
  save?(interrupted: boolean, drafts?: string[]): Promise<void>;
  close(): Promise<void>;
}

export interface ChatSummary extends SessionInfo {
  chat: string;
  approvals: ChatView['session']['approvals'];
  turn?: number;
  position?: number;
  glyph?: 'run' | 'ask' | 'idle' | 'err' | 'ok' | 'wait';
  unread?: boolean;
  interrupted?: boolean;
}

type QueuedPrompt = { text: string; send(): void };

/** Owns every loaded controller. Navigation never replaces another window's controller. */
export class ChatHub {
  readonly chats = new Map<string, HubChat>();
  private readonly unseen = new Set<string>();
  private readonly dormant = new Map<string, ChatSummary>();
  private archive: ReadonlyMap<string, number> = new Map();
  private readonly views = new Map<string, number>();
  private readonly lastSeen = new Map<string, number>();
  private readonly unloading = new Map<string, Promise<void>>();
  private readonly loading = new Map<string, Promise<HubChat | undefined>>();
  private readonly cleanup = setInterval(() => {
    void this.evict().catch(() => {});
  }, 30_000).unref();
  lastShown: string;
  busyPacks?: () => string[];
  onOpen?: (id: string) => void;
  private readonly waiting = new Map<string, QueuedPrompt[]>();
  private readonly listeners = new Set<() => void>();
  private readonly created = new Map<string, number>();
  private readonly navigation = new Map<string, number>();
  private opening: Promise<unknown> = Promise.resolve();
  private closing = false;
  private dirty = new Set<string>();
  private checkpointTimer?: NodeJS.Timeout;
  private writing: Promise<void> = Promise.resolve();
  private draining = false;

  constructor(
    private readonly create: (id: string) => Promise<HubChat>,
    public limit = 4,
    public initial: string = randomUUID(),
    private readonly exists?: (id: string) => Promise<boolean>,
    private readonly saveIndex?: (ids: string[], shown: string, chats: ChatSummary[]) => Promise<void>,
    private readonly resolveSession?: (
      id: string,
      source?: string,
    ) => Promise<Pick<SessionInfo, 'id' | 'source' | 'agent'> | undefined>,
    private readonly home = false,
    catalog?: ChatSummary[],
    private readonly onSaveError?: (error: unknown) => void,
  ) {
    this.lastShown = initial;
    for (const row of catalog ?? []) {
      if (row.chat) this.dormant.set(row.chat, row);
    }
  }

  shown(id: string) {
    this.lastShown = id;
    this.checkpoint(id);
    this.unseen.delete(id);
    this.views.set(id, (this.views.get(id) ?? 0) + 1);
    this.lastSeen.set(id, Date.now());
    return () => {
      this.views.set(id, Math.max(0, (this.views.get(id) ?? 1) - 1));
      this.lastSeen.set(id, Date.now());
    };
  }

  async reopen(id: string) {
    await this.unloading.get(id);
    const existing = this.chats.get(id);
    if (existing) return existing;
    let loading = this.loading.get(id);
    if (!loading) {
      loading = (async () => (!this.closing && (await this.exists?.(id)) ? this.load(id) : undefined))();
      this.loading.set(id, loading);
    }
    try {
      return await loading;
    } finally {
      if (this.loading.get(id) === loading) this.loading.delete(id);
    }
  }

  private mayUnload(id: string, { controller }: HubChat) {
    const { session } = controller.get();
    return (
      id !== this.initial &&
      !this.views.get(id) &&
      !this.waiting.has(id) &&
      !controller.artifacts?.list().length &&
      !controller.hasShellProcesses() &&
      session.status === 'idle' &&
      !session.approvals.length &&
      !session.queued.length &&
      !session.turns.some(
        (t) =>
          t.pack?.interactive &&
          t.pack.tasks.some(
            (w) =>
              w.state === 'unmerged' ||
              w.status === 'running' ||
              w.checks?.review?.status === 'running' ||
              w.checks?.verify?.status === 'running',
          ),
      )
    );
  }

  async unload(id: string) {
    const chat = this.chats.get(id);
    if (!chat || !this.mayUnload(id, chat)) return false;
    const row = this.summaries().find((row) => row.chat === id)!;
    if (this.hasHistory(chat)) this.dormant.set(id, row);
    else if (this.lastShown === id) this.lastShown = this.initial;
    this.chats.delete(id);
    const work = (async () => {
      try {
        if (this.hasHistory(chat)) await chat.save?.(!!chat.interrupted);
      } catch (error) {
        this.dormant.delete(id);
        this.chats.set(id, chat);
        throw error;
      }
      await chat.close();
    })();
    this.unloading.set(id, work);
    try {
      await work;
      return true;
    } finally {
      this.unloading.delete(id);
      this.checkpoint();
      this.changed();
    }
  }

  async evict(now = Date.now()) {
    const idle = [...this.chats]
      .filter(([id, chat]) => this.mayUnload(id, chat))
      .sort(([a], [b]) => this.lastSeen.get(a)! - this.lastSeen.get(b)!);
    await Promise.all(
      idle.map(async ([id], i) => {
        const age = now - this.lastSeen.get(id)!;
        if (age >= 30_000 && (age >= 600_000 || i < idle.length - 12)) await this.unload(id);
      }),
    );
  }

  private hasHistory(chat: HubChat) {
    const { session, recoveredDraft } = chat.controller.get();
    return !!(session.turns.length || session.sessionId || recoveredDraft || chat.interrupted);
  }

  private snapshot(
    id: string,
    chat: HubChat,
    interrupted = !!chat.interrupted || this.waiting.has(id) || chat.controller.get().session.status === 'running',
  ) {
    return chat.save?.(
      interrupted,
      this.waiting.get(id)?.map((p) => p.text),
    );
  }

  private index() {
    const rows = this.summaries()
      .filter((row) => {
        const chat = this.chats.get(row.chat);
        return !chat || this.hasHistory(chat) || row.chat === this.lastShown || this.waiting.has(row.chat);
      })
      .map((row) =>
        row.turnInProgress || row.position
          ? {
              ...row,
              turnInProgress: undefined,
              position: undefined,
              approvals: [],
              waitingFor: undefined,
              state: 'unfinished' as const,
              interrupted: true,
              glyph: 'err' as const,
              unread: true,
            }
          : row,
      );
    return this.saveIndex?.(
      rows.filter((row) => this.chats.has(row.chat)).map((row) => row.chat),
      this.lastShown,
      rows,
    );
  }

  // Coalesce streamed events and write only changed controllers. Shutdown takes its own immediate checkpoint.
  private checkpoint(id?: string) {
    if (this.closing || !this.saveIndex) return;
    if (id) this.dirty.add(id);
    this.checkpointTimer ??= setTimeout(() => {
      this.checkpointTimer = undefined;
      const ids = [...this.dirty];
      this.dirty.clear();
      this.writing = this.writing
        .then(async () => {
          if (this.closing) return;
          await Promise.all(
            ids.map((id) => {
              const chat = this.chats.get(id);
              if (chat && (this.hasHistory(chat) || this.lastShown === id || this.waiting.has(id)))
                return this.snapshot(id, chat);
            }),
          );
          await this.index();
        })
        .catch((error) => this.onSaveError?.(error));
    }, 250).unref();
  }

  private changed = () => {
    for (const listener of this.listeners) listener();
    queueMicrotask(() => this.drain());
  };

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async load(id: string) {
    const chat = await this.create(id);
    this.created.set(id, Date.now());
    this.lastSeen.set(id, Date.now());
    this.chats.set(id, chat);
    this.dormant.delete(id);
    let working = chat.controller.get().session.status === 'running';
    chat.controller.subscribe((view) => {
      if (working && view.session.status === 'idle' && !this.views.get(id)) this.unseen.add(id);
      if (!this.closing && view.session.status === 'running') chat.interrupted = false;
      this.checkpoint(id);
      working = view.session.status === 'running';
      this.changed();
    });
    this.checkpoint(id);
    this.changed();
    return chat;
  }

  setArchive(archive: ReadonlyMap<string, number>) {
    this.archive = archive;
    this.changed();
  }

  summaries(): ChatSummary[] {
    const queued = [...this.waiting.keys()];
    return [...this.chats]
      .map(([chat, { controller, interrupted }]): ChatSummary => {
        const { agents, conversation, session } = controller.get();
        const last = session.turns.at(-1);
        const source = agents.find((a) => a.name === session.agent)?.store;
        return {
          chat,
          source: session.sessionId && source ? source : 'genaicode:open:' + chat,
          id: session.sessionId ?? chat,
          agent: session.agent,
          where: 'local',
          cwd: session.cwd,
          title: conversation?.title ?? session.turns[0]?.prompt.split('\n')[0]?.slice(0, 120) ?? 'New chat',
          updatedAt: last?.endedAt ?? last?.startedAt ?? this.created.get(chat)!,
          state: session.approvals.length ? 'waiting' : session.status === 'running' ? 'active' : 'unfinished',
          ...(session.status === 'running' ? { turnInProgress: true } : {}),
          ...(session.approvals.length ? { waitingFor: 'approval' } : {}),
          glyph: queued.includes(chat)
            ? 'wait'
            : session.approvals.length
              ? 'ask'
              : session.status === 'running'
                ? 'run'
                : last?.result?.ok
                  ? 'ok'
                  : last?.result
                    ? 'err'
                    : 'idle',
          ...(interrupted ? { interrupted: true, glyph: 'err' as const } : {}),
          unread: this.unseen.has(chat),
          approvals: session.approvals,
          turn: last?.id,
          ...(queued.includes(chat) ? { position: queued.indexOf(chat) + 1 } : {}),
        };
      })
      .concat([...this.dormant.values()])
      .map((row) => ({ ...row, archived: isArchived(row, this.archive) || undefined }));
  }

  open(from: string, target: ChatSwitch, order?: SwitchOrder): Promise<string | null | undefined> {
    if (order) {
      if (order.seq <= (this.navigation.get(order.window) ?? 0)) return Promise.resolve(null);
      this.navigation.delete(order.window);
      this.navigation.set(order.window, order.seq);
      if (this.navigation.size > 256) this.navigation.delete(this.navigation.keys().next().value!);
    }
    const stale = () => order && this.navigation.get(order.window) !== order.seq;
    // Resolve ownership and register it as one operation, even for simultaneous opens.
    const work = this.opening.then(async () => {
      if (stale()) return null;
      if (this.closing) return;
      const current = this.chats.get(from);
      if (!current) return;
      if (target.type === 'stay') return from;
      if (target.type === 'continue') {
        const owners = this.summaries().filter(
          (row) => row.id === target.id && (!target.source || row.source === target.source),
        );
        if (owners.length > 1) {
          current.controller.note(
            'More than one store has this session ID. Select the session from the sidebar.',
            'error',
          );
          return;
        }
        if (owners[0]) return (await this.reopen(owners[0].chat)) ? owners[0].chat : undefined;
        let stored;
        try {
          stored = await this.resolveSession?.(target.id, target.source);
        } catch (error) {
          if (!stale())
            current.controller.note(error instanceof Error ? error.message : 'Could not find the session.', 'error');
          return stale() ? null : undefined;
        }
        if (stale()) return null;
        if (stored) {
          const live = this.summaries().find(
            (row) =>
              row.id === stored.id &&
              (row.source === stored.source ||
                (row.source.startsWith('genaicode:open:') && row.agent === stored.agent)),
          );
          if (live) return (await this.reopen(live.chat)) ? live.chat : undefined;
        }
        if (target.takeover && !this.home)
          return (await current.controller.continueSession(target.id, { source: target.source })) ? from : undefined;
      }
      const id = randomUUID();
      const chat = await this.load(id);
      let opened = false;
      try {
        opened = target.type === 'home' || (await chat.controller.switchChat(target)) === 'done';
        if (stale()) {
          opened = false;
          return null;
        }
        if (opened) return id;
        current.controller.note(chat.controller.get().notices.at(-1)?.text ?? 'Could not open the chat.', 'error');
      } finally {
        // A failed lookup must not leave an empty row.
        if (!opened) {
          this.chats.delete(id);
          this.created.delete(id);
          await chat.close();
          this.changed();
        }
      }
    });
    this.opening = work.catch(() => {});
    return work;
  }

  get active() {
    return this.running + this.waiting.size;
  }

  get running() {
    return [...this.chats.values()].filter((chat) => chat.controller.get().session.status === 'running').length;
  }

  schedule(id: string, prompt: QueuedPrompt) {
    if (this.closing) return;
    if (
      this.chats.get(id)?.controller.get().session.status === 'running' ||
      (!this.waiting.size && this.running < this.limit)
    ) {
      prompt.send();
      return;
    }
    const queue = this.waiting.get(id) ?? [];
    queue.push(prompt);
    this.waiting.set(id, queue);
    this.checkpoint(id);
    this.changed();
  }

  setLimit(limit: number) {
    this.limit = limit;
    this.changed();
  }

  cancel(id: string) {
    const prompts = this.waiting.get(id);
    this.waiting.delete(id);
    this.changed();
    if (!prompts?.length) return;
    this.chats.get(id)?.controller.recoverPrompts(prompts.map((p) => p.text));
    this.checkpoint(id);
    return prompts.map((p) => p.text);
  }

  private drain() {
    if (this.closing || this.draining) return;
    this.draining = true;
    try {
      while (this.waiting.size && this.running < this.limit) {
        const [id, prompts] = this.waiting.entries().next().value!;
        this.waiting.delete(id);
        for (const prompt of prompts) prompt.send();
        this.changed();
      }
    } finally {
      this.draining = false;
    }
  }

  async close() {
    this.closing = true;
    clearInterval(this.cleanup);
    clearTimeout(this.checkpointTimer);
    this.listeners.clear();
    await Promise.allSettled([this.opening, this.writing, ...this.unloading.values(), ...this.loading.values()]);
    const entries = [...this.chats];
    for (const [id, chat] of entries) {
      if (this.waiting.has(id) || chat.controller.get().session.status === 'running') chat.interrupted = true;
      this.cancel(id);
    }
    const sessionQueues = new Map(entries.map(([id, chat]) => [id, [...chat.controller.get().session.queued]]));
    const before = await Promise.allSettled([this.index(), ...entries.map(([id, chat]) => this.snapshot(id, chat))]);
    const after = await Promise.allSettled(
      entries.map(async ([id, chat]) => {
        await chat.close();
        await chat.save?.(!!chat.interrupted, sessionQueues.get(id));
      }),
    );
    this.chats.clear();
    const errors = [...before, ...after].filter((r) => r.status === 'rejected');
    if (errors.length)
      throw new AggregateError(
        errors.map((r) => r.reason),
        'Could not save or close every chat',
      );
  }
}
