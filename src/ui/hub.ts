import { randomUUID } from 'node:crypto';
import type { SessionInfo } from '../agents/sessions/types.js';
import type { ChatController, ChatSwitch, ChatView } from './controller.js';
import type { ProjectFiles } from './files.js';
import type { Uploads } from './uploads.js';

export interface HubChat {
  controller: ChatController;
  files: ProjectFiles;
  uploads: Uploads;
  save?(interrupted: boolean): Promise<void>;
  close(): Promise<void>;
}

export interface ChatSummary extends SessionInfo {
  chat: string;
  approvals: ChatView['session']['approvals'];
  turn?: number;
  position?: number;
  glyph?: 'run' | 'ask' | 'idle' | 'err' | 'ok' | 'wait';
  unread?: boolean;
}

type QueuedPrompt = { text: string; send(): void };

/** Owns every loaded controller. Navigation never replaces another window's controller. */
export class ChatHub {
  readonly chats = new Map<string, HubChat>();
  private readonly unseen = new Set<string>();
  private readonly dormant = new Map<string, ChatSummary>();
  private readonly views = new Map<string, number>();
  private readonly lastSeen = new Map<string, number>();
  private readonly unloading = new Map<string, Promise<void>>();
  private readonly loading = new Map<string, Promise<HubChat | undefined>>();
  private readonly cleanup = setInterval(() => {
    void this.evict().catch(() => {});
  }, 30_000).unref();
  lastShown: string;
  onOpen?: (id: string) => void;
  private readonly waiting = new Map<string, QueuedPrompt[]>();
  private readonly listeners = new Set<() => void>();
  private readonly created = new Map<string, number>();
  private opening: Promise<unknown> = Promise.resolve();
  private closing = false;
  private draining = false;

  constructor(
    private readonly create: (id: string) => Promise<HubChat>,
    public limit = 4,
    readonly initial: string = randomUUID(),
    private readonly exists?: (id: string) => Promise<boolean>,
    private readonly saveIndex?: (ids: string[], shown: string) => Promise<void>,
  ) {
    this.lastShown = initial;
  }

  shown(id: string) {
    this.lastShown = id;
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

  async evict(now = Date.now()) {
    const idle = [...this.chats]
      .filter(([id, { controller }]) => {
        const { session, shells } = controller.get();
        return (
          id !== this.initial &&
          !this.views.get(id) &&
          !this.waiting.has(id) &&
          !shells &&
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
      })
      .sort(([a], [b]) => this.lastSeen.get(a)! - this.lastSeen.get(b)!);
    for (const [i, [id, chat]] of idle.entries()) {
      const age = now - this.lastSeen.get(id)!;
      if (age < 30_000 || (age < 600_000 && i >= idle.length - 12)) continue;
      this.dormant.set(id, this.summaries().find((row) => row.chat === id)!);
      this.chats.delete(id);
      const work = (async () => {
        try {
          await chat.save?.(false);
        } catch (error) {
          this.chats.set(id, chat);
          throw error;
        }
        await chat.close();
      })();
      this.unloading.set(id, work);
      try {
        await work;
      } finally {
        this.unloading.delete(id);
        this.changed();
      }
    }
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
      working = view.session.status === 'running';
      this.changed();
    });
    this.changed();
    return chat;
  }

  summaries(): ChatSummary[] {
    const queued = [...this.waiting.keys()];
    return [...this.chats]
      .map(([chat, { controller }]): ChatSummary => {
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
          unread: this.unseen.has(chat),
          approvals: session.approvals,
          turn: last?.id,
          ...(queued.includes(chat) ? { position: queued.indexOf(chat) + 1 } : {}),
        };
      })
      .concat([...this.dormant.values()]);
  }

  open(from: string, target: ChatSwitch): Promise<string | undefined> {
    // Resolve ownership and register it as one operation, even for simultaneous opens.
    const work = this.opening.then(async () => {
      if (this.closing) return;
      const current = this.chats.get(from);
      if (!current) return;
      if (target.type === 'stay') return from;
      if (target.type === 'continue') {
        const owner = this.summaries().find(
          (row) => row.id === target.id && (!target.source || row.source === target.source),
        );
        if (owner) return (await this.reopen(owner.chat)) ? owner.chat : undefined;
        if (target.takeover)
          return (await current.controller.continueSession(target.id, { source: target.source })) ? from : undefined;
      }
      const id = randomUUID();
      const chat = await this.load(id);
      let opened = false;
      try {
        opened = target.type === 'home' || (await chat.controller.switchChat(target)) === 'done';
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
    return prompts?.map((p) => p.text).join('\n\n');
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
    await this.opening;
    this.waiting.clear();
    this.listeners.clear();
    await Promise.all([...this.unloading.values(), ...this.loading.values()]);
    const ids = [...this.chats.keys()];
    await Promise.all(
      [...this.chats.values()].map(async (chat) => {
        const interrupted = chat.controller.get().session.status === 'running';
        await chat.close();
        await chat.save?.(interrupted);
      }),
    );
    await this.saveIndex?.(ids, this.lastShown);
    this.chats.clear();
  }
}
