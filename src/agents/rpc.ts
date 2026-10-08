export type RequestId = number | string;

/** An incoming request in flight. */
export interface RpcRequestContext {
  /** The JSON-RPC id the peer gave the request. */
  id: RequestId;
  /** Aborts when the peer withdraws the request (`cancel(id)`) or the transport fails. */
  signal: AbortSignal;
}

export interface RpcHandlers {
  notification(method: string, params: unknown): void;
  /** Resolve with the result, or throw to send a JSON-RPC error. */
  request(method: string, params: unknown, context: RpcRequestContext): unknown | Promise<unknown>;
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
  private readonly incoming = new Map<RequestId, AbortController>();
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

  /** Abort the signal of an incoming request the peer no longer needs answered. */
  cancel(id: RequestId): boolean {
    const controller = this.incoming.get(id);
    controller?.abort();
    return controller !== undefined;
  }

  /** Reject everything in flight, abort incoming requests and refuse new requests. */
  fail(error: Error): void {
    this.failure ??= error;
    for (const controller of this.incoming.values()) controller.abort();
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.pending.clear();
  }

  private async answer(id: RequestId, method: string, params: unknown): Promise<void> {
    const controller = new AbortController();
    if (this.failure) controller.abort();
    this.incoming.get(id)?.abort();
    this.incoming.set(id, controller);
    try {
      const result = await this.handlers.request(method, params, { id, signal: controller.signal });
      this.send({ id, result: result ?? {} });
    } catch (error) {
      const code = error instanceof RpcError ? error.code : -32000;
      const message = error instanceof Error ? error.message : String(error);
      try {
        this.send({ id, error: { code, message } });
      } catch {
        // Transport closed; the exit status reports why.
      }
    } finally {
      if (this.incoming.get(id) === controller) this.incoming.delete(id);
    }
  }

  private send(value: Record<string, unknown>): void {
    if (this.failure) throw this.failure;
    this.write(JSON.stringify({ jsonrpc: '2.0', ...value }));
  }
}
