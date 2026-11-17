/**
 * `genaicode/browser`: an agent that runs in the page, on the browser's built-in model (Gemini
 * Nano through Chrome's Prompt API) or on a model behind your server (`remote()`), and the page's
 * tools offered to outside agents over WebMCP. Nothing here imports Node.
 *
 * ```ts
 * import { createPageAgent, exposeWebMcp, type PageTool } from 'genaicode/browser';
 *
 * const tools: PageTool[] = [
 *   { name: 'list_products', description: 'The products in the shop.', run: () => products },
 *   {
 *     name: 'add_to_cart',
 *     description: 'Put a product in the cart.',
 *     inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
 *     write: true, // the user approves it first
 *     run: ({ id }) => cart.add(String(id)),
 *   },
 * ];
 *
 * const assistant = createPageAgent({ instructions: 'You help shoppers on Example Shop.', tools });
 * exposeWebMcp(tools); // the same tools for the browser's own agent
 * ```
 *
 * Draw it with `<PageAgentChat agent={assistant} />` from `genaicode/react`.
 *
 * With a model behind your server (`createAgentBackend()` from `genaicode/backend`), the same page
 * agent runs on `remote({ url, tools })`, and `withFallback([remote(...), nano(...)])` goes on with
 * the built-in model when the server is out.
 */
export { nano, briefing } from './browser/nano.js';
export type { NanoAgent, NanoModelCall, NanoOptions, NanoTask } from './browser/nano.js';
export { remote } from './browser/remote.js';
export type { RemoteAgent, RemoteOptions } from './browser/remote.js';
export { withFallback } from './agents/failover.js';
export { createPageAgent } from './browser/page-agent.js';
export type { PageAgent, PageAgentOptions, PageAgentState, PageModelStatus } from './browser/page-agent.js';
export { exposeWebMcp, webMcpSupported, webMcpTools } from './browser/webmcp.js';
export type { ExposeWebMcpOptions } from './browser/webmcp.js';
export { argumentProblems, toolText } from './browser/tools.js';
export type { PageTool, PageToolOutput } from './browser/tools.js';
export { builtInLanguageModel, languageModelAvailability } from './browser/language-model.js';
export type {
  LanguageModelAvailability,
  LanguageModelCreateOptions,
  LanguageModelFactory,
  LanguageModelMessage,
  LanguageModelPromptOptions,
  LanguageModelSession,
} from './browser/language-model.js';
export { fakeLanguageModel } from './browser/fake-model.js';
export type { FakeCall, FakeReply } from './browser/fake-model.js';
export type { SessionEntry, SessionState, SessionTurn } from './agents/session.js';
export type {
  AgentEvent,
  AgentResult,
  AgentRun,
  AgentTask,
  ApprovalDecision,
  ApprovalRequest,
  CodingAgent,
} from './agents/types.js';
