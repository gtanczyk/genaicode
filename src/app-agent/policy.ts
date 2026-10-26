import { claude } from '../agents/drivers/claude.js';
import { codex } from '../agents/drivers/codex.js';
import { copilot } from '../agents/drivers/copilot.js';
import type { CodingAgent } from '../agents/types.js';
import type { AppAgentMode } from './state.js';

const WEB_TOOLS = ['WebFetch', 'WebSearch'];
// A subagent can outlive the turn, so its answer never reaches the user.
const SUBAGENT_TOOLS = ['Task', 'Agent'];

/**
 * The agents an app agent offers by default: the drivers that take per-run MCP servers,
 * locked down per mode. In `use` mode they get no shell and no file edits, only the app's
 * tools. In `dev` mode they edit files and may run `commands` (each with any arguments), never
 * commit or push (that goes through `propose_commit`); with `git`, Claude and Copilot may commit
 * and push. Claude asks through its permission prompt; headless Copilot cannot ask, so those
 * commands are allowed outright. Codex cannot push without network and has no per-command allowlist:
 * in `dev` mode its shell is bounded only by the `workspace-write` sandbox. In both modes the
 * only MCP server is the app's: the user's own configured servers are switched off. Claude's
 * hooks are off in both modes; Copilot's in `use` mode only (through settings in the app
 * agent's own working directory), since in `dev` mode they live in the user's repository.
 */
export function defaultAppAgents(
  mode: AppAgentMode,
  commands: readonly string[] = [],
  options: { git?: boolean } = {},
): CodingAgent[] {
  if (mode === 'use') {
    return [
      claude({
        permissionMode: 'dontAsk',
        strictMcpConfig: true,
        // The user's hooks would run shell commands on prompts that carry app data.
        settings: { disableAllHooks: true },
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
          ...SUBAGENT_TOOLS,
          ...WEB_TOOLS,
        ],
      }),
      // The sandbox alone still lets the shell read host files: drop the shell, image viewer and
      // web search.
      codex({
        sandbox: 'read-only',
        // Apps (connectors) are on by default and bypass the sandbox's network rules.
        config: {
          'features.shell_tool': false,
          'features.view_image': false,
          'features.apps': false,
          'features.hooks': false,
          web_search: 'disabled',
        },
        onlyTaskMcpServers: true,
      }),
      copilot({
        allowAllTools: false,
        denyTools: ['shell', 'write', 'read', 'url', 'memory'],
        // A deny rule leaves read-only tools such as web search in place; only this removes them.
        excludedTools: ['web_fetch', 'web_search'],
        onlyTaskMcpServers: true,
      }),
    ];
  }
  // Each command with any arguments. No git rules: `git diff --no-index` or `git log --output`
  // reach outside cwd; git asks through the agent's own permission prompt instead.
  const allowed = [...commands];
  const noGit = options.git ? [] : ['git commit', 'git push'];
  return [
    claude({
      permissionMode: 'acceptEdits',
      strictMcpConfig: true,
      // acceptEdits already reads and edits inside cwd without asking; no bare Read/Edit rules,
      // which would match every path on the machine.
      allowedTools: allowed.map((c) => `Bash(${c}:*)`),
      disallowedTools: [...noGit.map((c) => `Bash(${c}:*)`), ...WEB_TOOLS, ...SUBAGENT_TOOLS],
      // Hooks run commands outside these rules, `git commit` included.
      settings: { disableAllHooks: true },
    }),
    codex({
      sandbox: 'workspace-write',
      config: {
        'features.apps': false,
        'features.hooks': false,
        web_search: 'disabled',
        // The user's own config may open the sandbox up: no network, no roots beyond cwd.
        'sandbox_workspace_write.network_access': false,
        'sandbox_workspace_write.writable_roots': [],
      },
      onlyTaskMcpServers: true,
    }),
    copilot({
      allowAllTools: false,
      // `shell(npm test)` is the exact command only; `:*` adds any arguments.
      allowTools: [
        'write',
        ...[...allowed, ...(options.git ? ['git commit', 'git push'] : [])].flatMap((c) => [
          `shell(${c})`,
          `shell(${c}:*)`,
        ]),
      ],
      denyTools: noGit.flatMap((c) => [`shell(${c})`, `shell(${c}:*)`]),
      onlyTaskMcpServers: true,
    }),
  ];
}
