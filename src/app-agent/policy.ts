import { claude } from '../agents/drivers/claude.js';
import { codex } from '../agents/drivers/codex.js';
import { copilot } from '../agents/drivers/copilot.js';
import type { CodingAgent } from '../agents/types.js';

/** `use`: the agent works the app through its tools. `dev`: it also edits the app's own code. */
export type AppAgentMode = 'use' | 'dev';

const WEB_TOOLS = ['WebFetch', 'WebSearch'];
const READ_ONLY_GIT = ['git status', 'git diff', 'git log'];

/**
 * The agents an app agent offers by default: the drivers that take per-run MCP servers,
 * locked down per mode. In `use` mode they get no shell and no file edits, only the app's
 * tools. In `dev` mode they edit files and may run `commands` and read-only git, never
 * commit or push (that goes through `propose_commit`).
 */
export function defaultAppAgents(mode: AppAgentMode, commands: readonly string[] = []): CodingAgent[] {
  if (mode === 'use') {
    return [
      claude({
        permissionMode: 'dontAsk',
        strictMcpConfig: true,
        disallowedTools: ['Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', ...WEB_TOOLS],
      }),
      codex({ sandbox: 'read-only' }),
      copilot({ allowAllTools: false, denyTools: ['shell', 'write'] }),
    ];
  }
  const allowed = [...commands, ...READ_ONLY_GIT];
  return [
    claude({
      permissionMode: 'acceptEdits',
      strictMcpConfig: true,
      allowedTools: ['Read', 'Grep', 'Glob', 'Edit', 'Write', ...allowed.map((c) => `Bash(${c}:*)`)],
      disallowedTools: ['Bash(git commit:*)', 'Bash(git push:*)', ...WEB_TOOLS],
    }),
    codex({ sandbox: 'workspace-write' }),
    copilot({
      allowAllTools: false,
      allowTools: ['write', ...allowed.map((c) => `shell(${c})`)],
      denyTools: ['shell(git commit)', 'shell(git push)'],
    }),
  ];
}
