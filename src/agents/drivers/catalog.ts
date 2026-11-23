/**
 * Static setup metadata for every built-in coding agent CLI.
 *
 * Kept next to the drivers so install commands, sign-in commands and vendor links are reviewed
 * alongside the drivers themselves. genaicode never runs these installers or handles credentials;
 * it only shows them so the person can run them in Terminal.
 */
export interface AgentGuide {
  /** Driver name (`CodingAgent.name`): `claude`, `codex`, `copilot`... */
  readonly name: string;
  /** Human-readable product name. */
  readonly title: string;
  /** Vendor or maintainer. */
  readonly maker: string;
  /** One-line description mentioning whose subscription or key it uses. */
  readonly summary: string;
  /** Executable looked up on PATH. */
  readonly command: string;
  /** Install commands the person can copy and run in Terminal. Empty when installed from the vendor's site/app. */
  readonly install: readonly string[];
  /** Vendor install / setup documentation page. */
  readonly docsUrl?: string;
  /** Command to copy when signing in (e.g. `claude`, `codex login`). */
  readonly loginCommand?: string;
  /** One-line sign-in instruction shown alongside `loginCommand`. */
  readonly loginNote: string;
}

/**
 * Built-in agents in onboarding display order: most common first.
 */
export const AGENT_GUIDES: readonly AgentGuide[] = [
  {
    name: 'claude',
    title: 'Claude Code',
    maker: 'Anthropic',
    summary: 'Coding agent by Anthropic. Uses your Claude subscription or Anthropic API key.',
    command: 'claude',
    install: ['curl -fsSL https://claude.ai/install.sh | bash', 'npm i -g @anthropic-ai/claude-code'],
    docsUrl: 'https://docs.anthropic.com/en/docs/claude-code/setup',
    loginCommand: 'claude',
    loginNote: 'Run claude in Terminal, then type /login.',
  },
  {
    name: 'codex',
    title: 'Codex',
    maker: 'OpenAI',
    summary: 'Coding agent by OpenAI. Uses your ChatGPT subscription or OpenAI API key.',
    command: 'codex',
    install: ['npm i -g @openai/codex', 'brew install codex'],
    docsUrl: 'https://developers.openai.com/codex/cli',
    loginCommand: 'codex login',
    loginNote: 'Run codex login in Terminal to sign in.',
  },
  {
    name: 'copilot',
    title: 'GitHub Copilot CLI',
    maker: 'GitHub',
    summary: 'Coding agent by GitHub. Uses your GitHub Copilot subscription.',
    command: 'copilot',
    install: ['npm i -g @github/copilot'],
    docsUrl: 'https://docs.github.com/en/copilot/how-tos/use-copilot-agents/use-copilot-cli',
    loginCommand: 'copilot',
    loginNote: 'Run copilot in Terminal, then type /login.',
  },
  {
    name: 'antigravity',
    title: 'Antigravity',
    maker: 'Google',
    summary: 'Coding agent CLI (agy) by Google. Uses your Antigravity account.',
    command: 'agy',
    install: [],
    docsUrl: 'https://antigravity.google',
    loginCommand: 'agy',
    loginNote: 'Sign in through Antigravity or run agy in Terminal.',
  },
  {
    name: 'muse',
    title: 'Muse Code',
    maker: 'Muse',
    summary: 'Coding agent CLI (muse). Uses your own Muse Code sign-in.',
    command: 'muse',
    install: [],
    loginCommand: 'muse',
    loginNote: 'Sign in with muse in Terminal.',
  },
  {
    name: 'gemini',
    title: 'Gemini CLI',
    maker: 'Google',
    summary: 'Coding agent by Google. Uses your Google account or Gemini API key.',
    command: 'gemini',
    install: ['npm i -g @google/gemini-cli'],
    docsUrl: 'https://github.com/google-gemini/gemini-cli',
    loginCommand: 'gemini',
    loginNote: 'Run gemini in Terminal and follow the sign-in prompt.',
  },
  {
    name: 'cursor',
    title: 'Cursor Agent',
    maker: 'Cursor',
    summary: 'Coding agent CLI by Cursor. Uses your Cursor subscription or API key.',
    command: 'cursor-agent',
    install: ['curl https://cursor.com/install -fsS | bash'],
    docsUrl: 'https://docs.cursor.com/cli',
    loginCommand: 'cursor-agent login',
    loginNote: 'Run cursor-agent login in Terminal to sign in.',
  },
  {
    name: 'opencode',
    title: 'opencode',
    maker: 'OpenCode',
    summary: 'Open-source coding agent CLI. Uses your own model provider credentials.',
    command: 'opencode',
    install: ['npm i -g opencode-ai', 'brew install opencode'],
    docsUrl: 'https://opencode.ai/docs',
    loginCommand: 'opencode auth login',
    loginNote: 'Run opencode auth login in Terminal or export your provider API key.',
  },
  {
    name: 'vibe',
    title: 'Mistral Vibe',
    maker: 'Mistral',
    summary: 'Coding agent by Mistral. Uses your Mistral API key.',
    command: 'vibe',
    install: ['curl -LsSf https://mistral.ai/vibe/install.sh | bash'],
    docsUrl: 'https://docs.mistral.ai',
    loginCommand: 'vibe',
    loginNote: 'Run vibe in Terminal or export MISTRAL_API_KEY.',
  },
];

const BY_NAME = new Map(AGENT_GUIDES.map((guide, index) => [guide.name, { guide, index }]));
const BY_COMMAND = new Map(AGENT_GUIDES.map((guide, index) => [guide.command, { guide, index }]));

/** Look up the guide for a built-in driver (by name or command), or synthesize a minimal fallback. */
export function agentGuide(name: string, command = name): AgentGuide {
  const known = BY_NAME.get(name)?.guide ?? BY_COMMAND.get(command)?.guide;
  if (known) return command === known.command ? known : { ...known, command };
  return {
    name,
    title: name,
    maker: '',
    summary: 'Uses its own login, billing, and configuration.',
    command,
    install: [],
    loginCommand: command,
    loginNote: `Run ${command} in Terminal to sign in.`,
  };
}

/** Display order rank for onboarding: built-in agents follow `AGENT_GUIDES`, custom agents come after. */
export function agentOrder(name: string, command = name): number {
  return BY_NAME.get(name)?.index ?? BY_COMMAND.get(command)?.index ?? AGENT_GUIDES.length;
}
