/**
 * Model-provider credentials an agent CLI would otherwise pick up from the parent
 * process. Remove them when the agent should use its own login and billing instead
 * of your application's keys.
 */
export const PROVIDER_CREDENTIAL_VARS: readonly string[] = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_ORG_ID',
  'CODEX_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_GENAI_USE_VERTEXAI',
];

export interface ScrubEnvOptions {
  /** Variable names to drop: exact names or patterns. */
  names?: readonly (string | RegExp)[];
  /** Drop any variable whose value matches one of these (a token prefix, for example). */
  values?: readonly RegExp[];
}

/** A copy of `env` without the matching variables. `undefined` entries are dropped too. */
export function scrubEnv(env: NodeJS.ProcessEnv, options: ScrubEnvOptions): NodeJS.ProcessEnv {
  const names = options.names ?? [];
  const values = options.values ?? [];
  const result: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (names.some((match) => (typeof match === 'string' ? match === name : matches(match, name)))) continue;
    if (values.some((match) => matches(match, value))) continue;
    result[name] = value;
  }
  return result;
}

/** `test()` from the start every time: `/g` and `/y` patterns keep `lastIndex` between calls. */
function matches(pattern: RegExp, text: string): boolean {
  pattern.lastIndex = 0;
  return pattern.test(text);
}

/** `env` without `PROVIDER_CREDENTIAL_VARS`: the agent falls back to its own login. */
export function withoutProviderCredentials(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return scrubEnv(env, { names: PROVIDER_CREDENTIAL_VARS });
}
