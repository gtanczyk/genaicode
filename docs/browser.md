# An agent in the page (`genaicode/browser`)

[← README](../README.md)

`genaicode/browser` runs an agent **in the web page itself**, on the browser's built-in model
(Gemini Nano through Chrome's [Prompt API](https://developer.chrome.com/docs/ai/prompt-api)),
and offers the page's tools to outside agents over [WebMCP](https://webmachinelearning.github.io/webmcp/).
No server, no API key, no cost per token, and nothing the user types leaves their device.
Nothing in it imports Node.

It is a small model. It is good at "show me X", "what does this page say about Y", "switch
that on": one or two tool calls and a short answer. It does not write code; for that, put a
coding agent behind your app with [`genaicode/app-agent`](app-agent.md).

```ts
import { createPageAgent, exposeWebMcp, type PageTool } from 'genaicode/browser';

const tools: PageTool[] = [
  {
    name: 'list_products',
    description: 'The products in the shop, with id, name and price.',
    run: () => products,
  },
  {
    name: 'add_to_cart',
    description: 'Put a product in the cart.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    write: true, // the user approves it first
    summary: ({ id }) => `Add ${nameOf(id)} to your cart`,
    run: ({ id }) => cart.add(String(id)),
  },
];

export const assistant = createPageAgent({
  name: 'helper',
  instructions: 'You help shoppers on Example Shop. Prices are in euro.',
  tools,
});

exposeWebMcp(tools); // the same tools for the browser's own agent and extensions
```

```tsx
import { PageAgentChat } from 'genaicode/react';
import 'genaicode/react/styles.css';

<PageAgentChat agent={assistant} emptyState={<p>Ask me about the shop.</p>} />;
```

`<PageAgentChat>` is [`<AgentChat>`](react.md) wired to the page agent, with what an
on-device model needs on top: a note where the browser has no model (`unavailable`), a
"Download the model" button with progress, Approve/Deny for `write` tools, a chip that shows
how full the context window is, and "New". Without React, read `assistant.get()` and
`assistant.subscribe()` and call `send`, `stop`, `reset`, `approve` and `prepare` yourself.

## Tools

A `PageTool` is a function with a `name`, a `description` and a JSON Schema (`inputSchema`,
an object schema). `run(args, signal)` returns text, or any value, which is sent as JSON.

- `write: true` marks a tool that changes something. It runs only after the user approved the
  call; `summary(args)` is the line they read. An in-page agent asks in the chat, an outside
  agent goes through `exposeWebMcp`'s `confirm`.
- `validate(args)` may throw to refuse a call before anyone is asked. Required arguments,
  basic types and `enum` values are checked for you, and the problem goes back to the model.
- Keep the list short (a handful) and the outputs small: the model sees at most
  `maxToolOutput` characters (default 2,000) of each result. `enum` arguments help a small
  model the most.

A `PageTool` has the shape of `AppTool` from `genaicode/app-agent`, so one definition can serve
a coding agent on your server and the model in the page.

## How the model calls tools

The Prompt API has no tool calling, so `nano()` breaks every step into choices the browser
can constrain with a JSON Schema (`responseConstraint`):

1. Which action: one of the tool names, or `reply`.
2. The chosen tool's arguments, constrained by its `inputSchema`.
3. The tool runs; its result goes back and the model chooses again, up to `maxSteps` (default 6).
4. On `reply`, the answer streams as text.

The same exact call is never run twice in a task, bad arguments come back as an error the
model can fix, and a model that never picks `reply` is made to answer when the steps run out.

## The driver: `nano()`

`createPageAgent` is a conversation on top of `nano()`, which is a `CodingAgent` like every
driver in [`genaicode/agents`](agents.md): the same `run(task)`, events and result.

```ts
import { nano } from 'genaicode/browser';

const agent = nano({ instructions, tools });
if ((await agent.availability()) !== 'unavailable') {
  const run = agent.run({ prompt: 'Which plans include SSO?', cwd: '' });
  for await (const event of run) if (event.type === 'text-delta') render(event.text);
  const { text, sessionId } = await run.result; // pass sessionId as task.resume to go on
}
```

- `availability()`: `available`, `downloadable`, `downloading` or `unavailable`.
- `prepare()` loads the model, downloading it first when needed. A download needs a user
  gesture, so call it from a click; `onDownload(progress)` reports 0 to 1.
- Chrome fails some schema-constrained calls with an unexplained `UnknownError`. `nano` then asks
  the model the same thing in words and checks the answer itself, and a reply that fails before
  its first word is tried once more. An error that remains names the step: choosing the action,
  filling in the arguments or writing the reply.
- `onModelCall({ step, ms, constrained, error })` reports every call to the model, for logs and
  for finding the slow step.
- `task.onApproval` answers `write` tools (without it they are declined);
  `task.permissions.approval` `'auto-approve'` and `'deny'` work as in every driver.
  `permissions.sandbox: 'read-only'` refuses every `write` tool; a page has no other sandbox,
  so `'workspace-write'`, `'unrestricted'` and `'yolo'` fail the task.
- `task.resume` continues a conversation in the same model session; `forget(sessionId)` frees it.
  When the context window fills up, the browser drops the oldest messages and keeps the
  instructions. `context(sessionId)` says how full it is.
- Usage is what the task added to the conversation (`usage.totalTokens`), and
  `task.budget.maxTokens` stops a task that goes over it. There is no cost to cap.
- `task.cwd`, `env` and `mcpServers` mean nothing in a page. Pass `cwd: ''`.

`createPageAgent({ agent })` takes any other `CodingAgent` that runs in a browser instead.

## Files, images and voice

```ts
const assistant = createPageAgent({ tools, nano: { inputs: ['image', 'audio'] } });
assistant.send('What is on this screenshot?', [file]);
```

```tsx
<PageAgentChat agent={assistant} attachments />
```

`send(text, files)` takes `File`s or `Blob`s with a prompt, and `nano().run({ prompt, attachments })`
does the same one level down.

- A text file (by MIME type or extension: Markdown, JSON, CSV, source code) is read into the
  prompt, up to `maxAttachmentText` characters (default 4,000). The context window is small, so a
  long file is cut and the model is told so.
- An image or audio file goes to the model as it is, if `nano: { inputs }` asked for that kind
  and the browser's model takes it. `assistant.get().model.inputs` (and `nano().inputs()`) lists
  what it takes; elsewhere such a file fails the turn with a message that says why. Audio needs
  a GPU in Chrome.
- Anything else (a PDF, an archive) is refused.

With `attachments`, `<PageAgentChat>` adds an attach button, takes pasted and dropped files, and
shows a microphone where the model takes audio: it records a voice message that is sent as an
audio file, so speech stays on the device too. The chat offers only the kinds the model takes.
`<AgentChat attachments={{ accept, voice, max }}>` has the same composer for any host:
`onSend(text, files)` gets the files, and a turn's `attachments` are drawn under its prompt.

## WebMCP

`exposeWebMcp(tools, { confirm, onCall })` registers the tools on `document.modelContext`
(or `navigator.modelContext` in the first implementations), so an agent outside the page,
such as the browser's own assistant, calls your functions instead of guessing at the DOM.
Read tools are marked `readOnlyHint`, `write` tools `consequentialHint`, and a `write` tool
runs only after `confirm(tool, args)` resolves true (default: the browser's `confirm()`
dialog). It returns a function that takes the tools back, and does nothing where WebMCP is
missing, so it is safe to call everywhere.

`webMcpTools()` goes the other way: it lists what the page already registered over WebMCP
(by any script, or by annotated forms) as `PageTool`s for the in-page agent. It returns an
empty list where the browser cannot list tools.

## Where it runs

|                 |                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------ |
| Prompt API      | Chrome 148+ on desktop (Windows, macOS, Linux, Chromebook Plus). Not on Android or iOS.    |
| Hardware        | About 22 GB of free disk, and 16 GB of RAM or a GPU with more than 4 GB of VRAM.           |
| Languages       | English, Japanese, Spanish, German, French (`nano({ language })`, default `en`).           |
| First use       | The browser downloads the model once (a few GB); after that it works offline.              |
| WebMCP          | A draft: Chrome origin trial (149 to 156), Edge behind a flag. Register a trial token.     |
| Everything else | `availability()` is `unavailable`: show the page without the assistant, or use a fallback. |

Check `availability()` (or `<PageAgentChat>`'s `unavailable` slot) and treat the assistant as
an extra. A common setup loads it only where `'LanguageModel' in self`.

## Tests

`fakeLanguageModel(script)` stands in for the browser's model: replies come from `script` in
order and every prompt is recorded.

```ts
import { createPageAgent, fakeLanguageModel } from 'genaicode/browser';

const model = fakeLanguageModel(['{"action":"list_products"}', '{"action":"reply"}', 'Two products.']);
const assistant = createPageAgent({ tools, nano: { languageModel: model.factory } });
```

## Stability

Experimental, like the Prompt API and WebMCP themselves: names here may change in a minor
release.
