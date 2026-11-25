/** What a hidden credential is replaced with. */
const HIDDEN = '***';

/**
 * Credentials a tool call's argument may carry, each with what it becomes. They are hidden before an
 * argument is kept as a step of a task, shown in its timeline or sent to the lead.
 */
const SECRETS: Array<[RegExp, string]> = [
  // A URL with a password in it: https://user:pass@host.
  [/\b([a-z][a-z0-9+.-]*:\/\/[^\s/:@'"]+):[^\s/@'"]+@/gi, `$1:${HIDDEN}@`],
  // Auth headers, whatever their scheme: `Authorization: Bearer …`, `X-Api-Key: …`, `Cookie: …`.
  [
    /\b((?:proxy-)?authorization|x-api-key|api-key|x-auth-token|x-access-token|private-token|cookie)(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|(?:(?:bearer|basic|token|digest)\s+)?[^\s'",;]+)/gi,
    `$1$2${HIDDEN}`,
  ],
  // A token given with its scheme anywhere else.
  [/\b(bearer|basic)\s+[\w.~+/=-]{8,}/gi, `$1 ${HIDDEN}`],
  // Flags that take a secret: `--password x`, `--token=x`, `--api-key x`.
  [
    /(^|\s)(--?(?:password|passwd|pass|token|access-token|auth-token|api-key|apikey|secret|client-secret|private-key))(=|\s+)(?:"[^"]*"|'[^']*'|\S+)/gi,
    `$1$2$3${HIDDEN}`,
  ],
  // `-u user:pass` (curl and the like).
  [/(^|\s)(-u|--user)(=|\s+)(["']?)([^\s:'"]+):[^\s'"]+\4/g, `$1$2$3$4$5:${HIDDEN}$4`],
  // `-p` with the password attached (`mysql -psecret`), and `sshpass -p secret`.
  [/(\b(?:mysql\w*|mariadb\w*)\b[^|;&\n]*?\s-p)(?!\s)(?:"[^"]*"|'[^']*'|\S+)/gi, `$1${HIDDEN}`],
  [/(\bsshpass\b[^|;&\n]*?\s-p\s*)(?:"[^"]*"|'[^']*'|\S+)/gi, `$1${HIDDEN}`],
  // Assignments to a secret's name: `API_KEY=…`, `GITHUB_TOKEN=…`, `db_password=…`, `?api_key=…`.
  [
    /\b((?:[a-z0-9]+_)*(?:api_?key|access_?key|key|token|secret|password|passwd|pass|credentials?|auth)(?:_[a-z0-9]+)*)(\s*=\s*)(?:"[^"]*"|'[^']*'|[^\s&'";]+)/gi,
    `$1$2${HIDDEN}`,
  ],
  // `"password": "…"` in JSON or YAML.
  [
    /(["']?\b(?:password|passwd|secret|token|api_?key|access_?token|client_?secret)["']?\s*:\s*)(?:"[^"]*"|'[^']*'|[^\s,}]+)/gi,
    `$1${HIDDEN}`,
  ],
  // Keys known by their prefix: OpenAI and Anthropic (sk-), GitHub, Slack, GitLab, npm, AWS, Google.
  [
    /\b(sk-(?:ant-(?:api\d+-)?|proj-|live-|test-)?|gh[pousr]_|github_pat_|xox[abposr]-|xapp-|glpat-|npm_|AIza)[\w-]{8,}/g,
    `$1${HIDDEN}`,
  ],
  [/\b(AKIA|ASIA)[A-Z0-9]{16}\b/g, `$1${HIDDEN}`],
];

/** `text` with the credentials in it replaced by `***`: auth headers, tokens, passwords, keys. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const [pattern, replacement] of SECRETS) out = out.replace(pattern, replacement);
  return out;
}
