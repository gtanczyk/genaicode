# A model behind your server for the page (`genaicode/backend`)

[← README](../README.md) · [genaicode/browser](browser.md)

`genaicode/backend` puts a model behind your server for the assistant in your web page. The
model and its key stay on the server; the page's tools still run in the page, and the user still
approves every `write` call there; server tools run on the server for the signed-in user. In
the page, `remote()` from [`genaicode/browser`](browser.md) is the driver, so `createPageAgent`,
`<PageAgentChat>`, approvals and WebMCP work as they do with Gemini Nano.

Use it where the built-in model is missing (most phones, Safari, Firefox, weaker hardware),
too small for the job, or where the assistant needs your data and your actions.

It runs one model with tools, for many visitors at once, and keeps nothing running between
requests. To let a coding agent (Claude Code, Codex) work on your app from a page, use
[`genaicode/app-agent`](app-agent.md) instead: that one runs a live agent process for you.

```ts
// server
import { genaicode } from 'genaicode';
import { anthropic } from 'genaicode/providers';
import { createAgentBackend, toNodeListener } from 'genaicode/backend';

const backend = createAgentBackend({
  client: genaicode(anthropic({ model: 'claude-haiku-4-5' })),
  instructions: 'You help shoppers on Example Shop. Prices are in euro.',
  secret: process.env.ASSISTANT_SECRET!, // 32+ characters, encrypts the conversation token
  authorize: (request) => userFromCookie(request), // { id } or null (401)
  pageTools: [
    { name: 'list_products', description: 'The products in the shop.' },
    {
      name: 'add_to_cart',
      description: 'Put a product in the cart.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      write: true,
    },
  ],
  tools: [
    {
      name: 'order_status',
      description: "The status of the user's last order.",
      run: (_args, { user }) => orders.lastOf(user!.id), // the user from authorize, never from the model
    },
  ],
});

app.use(toNodeListener(backend)); // Express, Connect, node:http
// Workers, Deno, Bun, Vercel: export default { fetch: (request) => backend.handle(request) };
```

```ts
// page
import { createPageAgent, nano, remote, withFallback } from 'genaicode/browser';

const assistant = createPageAgent({
  name: 'helper',
  tools, // PageTool[]: the same list as for nano()
  agent: withFallback([remote({ url: '/api/assistant', tools }), nano({ tools })]),
});
```

`withFallback` goes on with the built-in model when the backend is out: signed out (`auth`),
over its allowance (`quota`), unreachable or failing (`unavailable`). Put `nano()` first to use
the free, private model where the browser has it and the server everywhere else. A prompt that
already ran a `write` tool is not handed on: the run fails, so the action does not happen twice.

## How a turn runs

`POST <base>/turn` streams NDJSON: text as it comes, server tool steps, and a last `turn-end`
line. When the model calls a page tool, or a server tool that needs approval, the stream ends
with `status: 'waiting'` and the calls; the page runs them (asking the user before a `write`
one) and posts the results with the `state` it got. Nothing waits on the server between
requests, so it runs on serverless hosts.

| Route              | What it does                                                                         |
| ------------------ | ------------------------------------------------------------------------------------ |
| `POST <base>/turn` | `{ state?, prompt, images?, tools? }`, or `{ state, results?, approvals? }` to go on |
| `GET <base>/info`  | `{ name, model, inputs, available, resetsAt? }`: `remote().info()`                   |

`basePath` is `/api/assistant` by default.

## Security

The page belongs to the user, so the server trusts nothing it sends: not the conversation, not
tool results, not approvals.

- **Costs.** Anyone who can reach the URL can ask the model anything, so costs are held by
  limits that are on by default: `limits.maxOutputTokens` (1,024), `maxSteps` model calls per
  prompt (8), `conversationTokens` (100,000), body, prompt and image sizes, and a `limiter`
  with daily allowances per user and in all (`memoryLimiter()`: 200,000 and 2,000,000 tokens;
  back it with your store when you run more than one instance). Each model call first reserves
  its input and a full answer, so calls running at once cannot spend the same rest of an
  allowance; a custom `limiter` must `reserve` in one step (a transaction). A provider that reports no
  usage is counted at about four characters a token. `createAgentBackend` refuses to start
  without `authorize`, unless you set `public: true`.
- **The conversation** travels in a token encrypted and authenticated with `secret`
  (AES-256-GCM), with the user's id and an expiry (`stateTtlMs`, 24 hours) inside; a changed,
  expired or someone else's token gets 409 and the page starts over. With `store` the token
  only names a conversation kept on the server. Images stay in the token only while their turn
  waits on the page.
- **Page tools** run in the page, so they cannot touch the server. Listing them in `pageTools`
  keeps the model's tool list in your hands; `'from-client'` lets the page choose it with each
  request (checked: at most 32, names, sizes, no clash with server tools).
- **Server tools** act for `context.user`. Check what that user may do there, never from the
  arguments: the model wrote them, and the model reads text other people wrote. A `write`
  server tool waits for the user's approval in the page. A tool that throws shows the model
  and the page `The tool failed.` (the error goes to `onError`); throw a `ToolError` for words
  they should see. A step that fails after a tool ran keeps
  its result, so a retry does not run it again, and with `store` one instance takes one request
  per conversation at a time. An old token can still be posted again, and instances sharing a
  store do not see each other's requests, so make `write` tools safe to repeat (an order id, a
  check of what is done).
- **Prompt injection.** Tool results are marked as data in the system prompt, `write` tools on
  both sides need a click, and the model's provider error text never reaches the page.
- **Cross-site requests** are refused (`Sec-Fetch-Site`, `Origin`) unless their origin is in
  `allowedOrigins` (CORS, no cookies). Posts must be `application/json`.
- **Privacy.** Unlike Gemini Nano, what the user types leaves the device. Nothing here logs
  conversation text; `onTurn` gets counts only.

## Stability

Experimental: names here may change in a minor release.
