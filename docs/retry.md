# Retry classification and idempotency

GenAIcode does **not** retry provider calls automatically. Retries, backoff, and
failure budgets belong to application code so side effects stay explicit.

## Classify, then decide

```ts
import { classifyError, isRetryable, withRetry } from 'genaicode';

const classified = classifyError(error);
if (classified.retryable) {
  // transient: 408/425/429/5xx, network resets, overload heuristics
}

await withRetry(() => ai('summarize this').text(), {
  attempts: 3,
  delayMs: 250,
  shouldRetry: (error) => isRetryable(error),
});
```

`classifyError` returns `{ class, retryable, reason, status?, code?, cause }`:

| Class       | Typical causes                         | Retry? |
| ----------- | -------------------------------------- | ------ |
| `transient` | 429, 5xx, timeouts, connection resets  | yes    |
| `permanent` | 4xx (except above), auth, abort        | no     |
| `unknown`   | Unrecognized shapes                    | no*    |

\*Treat unknown as non-retryable by default; override with `shouldRetry` when you
know more about your gateway.

## Idempotency guidance

Safe to retry without extra coordination:

- Pure generation (`text`, `json`, `toolCalls` that only *propose* tool calls)
- Read-only prompts against immutable inputs

Not safe to retry blindly:

- Application code that executes tool calls with side effects (writes, charges, emails)
- Chains where a partial turn already mutated external state

Patterns that keep retries safe:

1. **Propose, then commit.** Let the model return a plan; apply side effects once
   after validation.
2. **Idempotency keys.** If a tool must run inside a retry loop, key the effect
   (e.g. `Idempotency-Key` on a payment API) so duplicates collapse.
3. **Outbox / queue.** Persist the intended effect before calling the provider, or
   after a successful model response but before side effects, depending on your
   failure mode.
4. **Do not put retries inside plugins by default.** A retry plugin hides policy
   from callers; prefer `withRetry` at the call site or a named, intentional plugin.

## Streaming

If a stream fails mid-flight, do not assume the partial text was committed anywhere.
Re-run the full request (or resume with your own checkpointing). Conversation
chains only append history after a successful completed turn.
