import { describe, expect, it } from 'vitest';
import { redactSecrets } from './redact.js';

describe('redactSecrets', () => {
  it.each([
    ['curl -H "Authorization: Bearer abcdef123456789" https://x', 'curl -H "Authorization: ***" https://x'],
    ['curl -H "Authorization: Basic dXNlcjpwYXNz" https://x', 'curl -H "Authorization: ***" https://x'],
    ["curl -H 'X-Api-Key: zzzz1234' https://x", "curl -H 'X-Api-Key: ***' https://x"],
    ['echo Bearer abcdefghijkl', 'echo Bearer ***'],
    ['curl -u admin:hunter2 https://x', 'curl -u admin:*** https://x'],
    ["curl -H 'Cookie: theme=dark; sessionid=example-session' https://x", "curl -H 'Cookie: ***' https://x"],
    ['curl -H "Set-Cookie: a=1; sid=abc; Path=/" https://x', 'curl -H "Set-Cookie: ***" https://x'],
    ["curl --header='Authorization: Token two words' https://x", "curl --header='Authorization: ***' https://x"],
    ['curl -H Cookie:sid=abc https://x', 'curl -H Cookie:*** https://x'],
    ['{"Cookie": "a=1; sid=abc", "x": 1}', '{"Cookie": ***, "x": 1}'],
    ["curl -u 'admin:two words' https://x", "curl -u 'admin:***' https://x"],
    ['curl --user "admin:two \\"words\\"" https://x', 'curl --user "admin:***" https://x'],
    ['curl --user=admin:pa\\ ss https://x', 'curl --user=admin:*** https://x'],
    ['git clone https://bob:s3cr3t@github.com/a/b.git', 'git clone https://bob:***@github.com/a/b.git'],
    ['deploy --password hunter2 --token=abc', 'deploy --password *** --token=***'],
    ["deploy --api-key 'a b'", 'deploy --api-key ***'],
    ['mysql -u root -psecretpw db', 'mysql -u root -p*** db'],
    ['sshpass -p hunter2 ssh host', 'sshpass -p *** ssh host'],
    ['OPENAI_API_KEY=sk-proj-abcdefghijk123 npm test', 'OPENAI_API_KEY=*** npm test'],
    ['export GITHUB_TOKEN="ghp_abcdefghijklmnop1234" && gh pr list', 'export GITHUB_TOKEN=*** && gh pr list'],
    ['DB_PASSWORD=pw AWS_SECRET_ACCESS_KEY=x run', 'DB_PASSWORD=*** AWS_SECRET_ACCESS_KEY=*** run'],
    ['curl https://x/api?api_key=abc123&q=1', 'curl https://x/api?api_key=***&q=1'],
    ['{"password": "pw", "user": "u"}', '{"password": ***, "user": "u"}'],
    ['echo sk-ant-api03-abcdefghijkl', 'echo sk-ant-api03-***'],
    ['echo AKIAABCDEFGHIJKLMNOP xoxb-12345678-abcdef glpat-abcdefghijkl', 'echo AKIA*** xoxb-*** glpat-***'],
  ])('hides the credential in %s', (text, hidden) => {
    expect(redactSecrets(text)).toBe(hidden);
  });

  it.each([
    'mkdir -p src/a && npm test -- cart',
    'docker run -p 8080:80 img',
    'grep -rn monkey=1 src/',
    'src/agents/pack.ts',
    'git commit -m "risk-assessment notes"',
  ])('leaves %s as it is', (text) => {
    expect(redactSecrets(text)).toBe(text);
  });
});
