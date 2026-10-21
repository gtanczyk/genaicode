import { claude } from '../agents/drivers/claude.js';
import { codex } from '../agents/drivers/codex.js';
import { copilot } from '../agents/drivers/copilot.js';
import type { CodingAgent } from '../agents/types.js';
import type { AppAgentMode } from './state.js';

const WEB_TOOLS = ['WebFetch', 'WebSearch'];

/**
 * The agents an app agent offers by default: the drivers that take per-run MCP servers,
 * locked down per mode. In `use` mode they get no shell and no file edits, only the app's
 * tools. In `dev` mode they edit files and may run `commands` (each with any arguments), never
 * commit or push (that goes through `propose_commit`). Codex has no per-command allowlist:
 * in `dev` mode its shell is bounded only by the `workspace-write` sandbox. In both modes the
 * only MCP server is the app's: the user's own configured servers are switched off.
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
      // The sandbox alone still lets the shell read host files: drop the shell, image viewer and
      // web search.
      codex({
        sandbox: 'read-only',
        config: { 'features.shell_tool': false, 'features.view_image': false, web_search: 'disabled' },
        onlyTaskMcpServers: true,
      }),
      copilot({
        allowAllTools: false,
        denyTools: ['shell', 'write', 'read', 'url', 'memory'],
        onlyTaskMcpServers: true,
      }),
    ];
  }
  // Each command with any arguments. No git rules: `git diff --no-index` or `git log --output`
  // reach outside cwd; git asks through the agent's own permission prompt instead.
  const allowed = [...commands];
  return [
    claude({
      permissionMode: 'acceptEdits',
      strictMcpConfig: true,
      // acceptEdits already reads and edits inside cwd without asking; no bare Read/Edit rules,
      // which would match every path on the machine.
      allowedTools: allowed.map((c) => `Bash(${c}:*)`),
      disallowedTools: ['Bash(git commit:*)', 'Bash(git push:*)', ...WEB_TOOLS],
    }),
    codex({ sandbox: 'workspace-write', config: { web_search: 'disabled' }, onlyTaskMcpServers: true }),
    copilot({
      allowAllTools: false,
      // `shell(npm test)` is the exact command only; `:*` adds any arguments.
      allowTools: ['write', ...allowed.flatMap((c) => [`shell(${c})`, `shell(${c}:*)`])],
      denyTools: ['shell(git commit)', 'shell(git commit:*)', 'shell(git push)', 'shell(git push:*)'],
      onlyTaskMcpServers: true,
    }),
  ];
}
