/**
 * `genaicode/backend`: a model behind your server for assistants in web pages
 * (`remote()` in `genaicode/browser`). The model and its key stay on the server, the page's
 * tools run in the page, server tools run here for the signed-in user. `handle` takes a web
 * `Request`; `toNodeListener` serves it from Node's own servers.
 *
 * ```ts
 * import { genaicode } from 'genaicode';
 * import { anthropic } from 'genaicode/providers';
 * import { createAgentBackend, toNodeListener } from 'genaicode/backend';
 *
 * const backend = createAgentBackend({
 *   client: genaicode(anthropic({ model: 'claude-haiku-4-5' })),
 *   instructions: 'You help shoppers on Example Shop.',
 *   secret: process.env.ASSISTANT_SECRET!,
 *   authorize: (request) => userFromCookie(request),
 *   pageTools: [{ name: 'add_to_cart', description: 'Put a product in the cart.', write: true }],
 * });
 * app.use(toNodeListener(backend)); // POST /api/assistant/turn, GET /api/assistant/info
 * ```
 */
export { createAgentBackend, ToolError } from './backend/backend.js';
export type {
  AgentBackend,
  AgentBackendLimits,
  AgentBackendOptions,
  BackendStore,
  BackendTurnReport,
  BackendUser,
  ServerTool,
  ServerToolContext,
} from './backend/backend.js';
export { memoryLimiter } from './backend/limiter.js';
export type { BackendLimiter, LimitCheck, MemoryLimiterOptions } from './backend/limiter.js';
export { toNodeListener } from './backend/node.js';
export type {
  BackendInfo,
  BackendRefusal,
  PageCall,
  PageToolSpec,
  TurnEnd,
  TurnLine,
  TurnRequest,
} from './backend/protocol.js';
