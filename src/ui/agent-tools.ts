/**
 * The session index as an MCP server in the agents' own configuration (`genaicode mcp install`),
 * offered from Settings › Agents so the agents' own chats get the session tools too.
 */
export interface AgentToolsEntry {
  /** One of `MCP_INSTALL_AGENTS` whose CLI is found here. */
  agent: string;
  /** Whether a server named `genaicode` is declared in the agent's configuration. */
  installed: boolean;
  /** Whether it starts the command this genaicode would register. */
  current: boolean;
  /** Whether it also serves `sessions_send`. */
  send: boolean;
  /** The agent's file its user-level MCP servers are declared in. */
  file: string;
}

export interface AgentToolsListing {
  agents: AgentToolsEntry[];
  /**
   * False where this genaicode runs from a place agents could not start it from later (npx's
   * cache, an AppImage's mount) and no installed command stands in: nothing is offered then.
   */
  durable: boolean;
}

export interface AgentTools {
  list(): Promise<AgentToolsListing>;
  /** Adds (or updates) the server for `agent`, or takes it out, and lists again. */
  change(agent: string, add: boolean): Promise<AgentToolsListing>;
}
