type RequestId = number | string;

export interface RpcHandlers {
  notification(method: string, params: unknown): void;
  /** Resolve with the result, or throw to send a JSON-RPC error. */
  request(method: string, params: unknown): unknown | Promise<unknown>;
}

export class RpcError extends Error {
  constructor(
    message: string,
    readonly code = -32000,
  ) {
    super(message);
    this.name = 'RpcError';
  }
}

/**
 * Minimal JSON-RPC 2.0 peer over newline-delimited JSON. The caller owns the
 * transport: it hands incoming values to `receive` and supplies `write`.
 */
export class RpcPeer {
  private nextId = 0;
  private failure: Error | undefined;
  private readonly pending = new Map<
    RequestId,
    { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }
  >();

  constructor(
    private readonly write: (line: string) => void,
    private readonly handlers: RpcHandlers,
  ) {}

  request(method: string, params: unknown = {}, timeoutMs = 30_000): Promise<unknown> {
    if (this.failure) return Promise.reject(this.failure);
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new RpcError(`No reply to ${method} within ${timeoutMs} ms; its outcome is unknown.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  notify(method: string, params: unknown = {}): void {
    this.send({ method, params });
  }

  /** Handle one incoming JSON value. Returns false when it is not a JSON-RPC message. */
  receive(message: unknown): boolean {
    if (typeof message !== 'object' || message === null) return false;
    const { id, method, params, result, error } = message as {
      id?: RequestId;
      method?: unknown;
      params?: unknown;
      result?: unknown;
      error?: { message?: unknown; code?: unknown };
    };
    if (typeof method === 'string') {
      if (id === undefined) this.handlers.notification(method, params ?? {});
      else void this.answer(id, method, params ?? {});
      return true;
    }
    if (id === undefined || !this.pending.has(id)) return false;
    const waiter = this.pending.get(id)!;
    this.pending.delete(id);
    clearTimeout(waiter.timer);
    if (error) {
      waiter.reject(
        new RpcError(
          typeof error.message === 'string' ? error.message : 'Request rejected.',
          typeof error.code === 'number' ? error.code : undefined,
        ),
      );
    } else waiter.resolve(result ?? {});
    return true;
  }

  /** Reject everything in flight and refuse new requests. */
  fail(error: Error): void {
    this.failure ??= error;
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.pending.clear();
  }

  private async answer(id: RequestId, method: string, params: unknown): Promise<void> {
    try {
      const result = await this.handlers.request(method, params);
      this.send({ id, result: result ?? {} });
    } catch (error) {
      const code = error instanceof RpcError ? error.code : -32000;
      const message = error instanceof Error ? error.message : String(error);
      try {
        this.send({ id, error: { code, message } });
      } catch {
        // Transport closed; the exit status reports why.
      }
    }
  }

  private send(value: Record<string, unknown>): void {
    if (this.failure) throw this.failure;
    this.write(JSON.stringify({ jsonrpc: '2.0', ...value }));
  }
}
