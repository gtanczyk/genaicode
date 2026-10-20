import { claude } from '../agents/drivers/claude.js';
import { codex } from '../agents/drivers/codex.js';
import { copilot } from '../agents/drivers/copilot.js';
import type { CodingAgent } from '../agents/types.js';
import type { AppAgentMode } from './state.js';

const WEB_TOOLS = ['WebFetch', 'WebSearch'];
const READ_ONLY_GIT = ['git status', 'git diff', 'git log'];

/**
 * The agents an app agent offers by default: the drivers that take per-run MCP servers,
 * locked down per mode. In `use` mode they get no shell and no file edits, only the app's
 * tools. In `dev` mode they edit files and may run `commands` and read-only git, never
 * commit or push (that goes through `propose_commit`). Codex has no per-command allowlist:
 * in `dev` mode its shell is bounded only by the `workspace-write` sandbox.
 */
export function defaultAppAgents(mode: AppAgentMode, commands: readonly string[] = []): CodingAgent[] {
  if (mode === 'use') {
    return [
      claude({
        permissionMode: 'dontAsk',
        strictMcpConfig: true,
        // Read tools too: user settings may pre-allow them, and dontAsk runs pre-allowed tools.
        disallowedTools: [
          'Bash',
          'Read',
          'Grep',
          'Glob',
          'LS',
          'Edit',
          'Write',
          'MultiEdit',
          'NotebookEdit',
          'NotebookRead',
          'Task',
          ...WEB_TOOLS,
        ],
      }),
      // The sandbox alone still lets the shell read host files: drop the shell and image viewer.
      codex({ sandbox: 'read-only', config: { 'features.shell_tool': false, 'features.view_image': false } }),
      copilot({ allowAllTools: false, denyTools: ['shell', 'write'] }),
    ];
  }
  const allowed = [...commands, ...READ_ONLY_GIT];
  return [
    claude({
      permissionMode: 'acceptEdits',
      strictMcpConfig: true,
      // acceptEdits already reads and edits inside cwd without asking; no bare Read/Edit rules,
      // which would match every path on the machine.
      allowedTools: allowed.map((c) => `Bash(${c}:*)`),
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
