import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ArtifactError, artifactResponse, createArtifactStore, startArtifactChannel } from './artifacts.js';
import { createAgentSession } from './session.js';
import type { AgentResult, AgentRun, AgentTask, CodingAgent } from './types.js';

const root = mkdtempSync(join(tmpdir(), 'genaicode-artifacts-'));
const cwd = join(root, 'work');
mkdirSync(join(cwd, '.git'), { recursive: true });
mkdirSync(join(cwd, 'docs'));
writeFileSync(join(cwd, 'report.html'), '<h1>Report</h1>');
writeFileSync(join(cwd, 'docs', 'notes.md'), '# Notes');
writeFileSync(join(cwd, 'chart.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
writeFileSync(join(cwd, 'data.bin'), Buffer.from([0, 1, 2]));
writeFileSync(join(cwd, '.env.local'), 'TOKEN=secret');
writeFileSync(join(cwd, 'server.pem'), 'key');
writeFileSync(join(cwd, '.git', 'config'), '[core]');
writeFileSync(join(root, 'outside.txt'), 'outside');
symlinkSync(join(root, 'outside.txt'), join(cwd, 'link.txt'));
writeFileSync(join(cwd, 'shot.png'), Buffer.alloc(10));
writeFileSync(join(cwd, 'beep.mp3'), Buffer.alloc(40));
writeFileSync(join(cwd, 'demo.webm'), Buffer.from('0123456789'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('artifact store', () => {
  it('publishes files from the working directory, typed by extension', async () => {
    const store = createArtifactStore({ cwd });
    const page = await store.publish({ title: 'Report', path: 'report.html' });
    expect(page).toMatchObject({ kind: 'html', mimeType: 'text/html; charset=utf-8', version: 1, path: 'report.html' });
    expect(page.id).toMatch(/^[0-9a-f]{32}$/);
    expect(store.read(page.id)?.body.toString()).toBe('<h1>Report</h1>');
    expect(await store.publish({ title: 'Notes', path: 'docs/notes.md' })).toMatchObject({ kind: 'text' });
    expect(await store.publish({ title: 'Chart', path: join(cwd, 'chart.svg') })).toMatchObject({
      kind: 'image',
      mimeType: 'image/svg+xml',
    });
    expect(await store.publish({ title: 'Data', path: 'data.bin' })).toMatchObject({
      kind: 'file',
      mimeType: 'application/octet-stream',
    });
    expect(store.read('nope')).toBeUndefined();
  });

  it('refuses files outside the directory, secrets, and anything too large', async () => {
    const store = createArtifactStore({ cwd, maxBytes: 20 });
    const refused = (input: Parameters<typeof store.publish>[0]) =>
      expect(store.publish(input)).rejects.toBeInstanceOf(ArtifactError);
    await refused({ title: 'x', path: '../outside.txt' });
    await refused({ title: 'x', path: join(root, 'outside.txt') });
    // A link inside the workspace that points out of it.
    await refused({ title: 'x', path: 'link.txt' });
    await refused({ title: 'x', path: '.env.local' });
    await refused({ title: 'x', path: 'server.pem' });
    await refused({ title: 'x', path: '.git/config' });
    await refused({ title: 'x', path: 'docs' });
    await refused({ title: 'x', path: 'missing.html' });
    await refused({ title: 'x', path: 'chart.svg' }); // over 20 bytes
    await refused({ title: 'x', content: 'a'.repeat(21) });
    await refused({ title: 'x' });
    await refused({ title: 'x', path: 'report.html', content: 'both' });
    await refused({ title: ' ', content: 'no title' });
    await refused({ title: 'x', content: 'y', format: 'exe' as never });
    expect(store.list()).toEqual([]);
  });

  it('replaces an artifact published under the same name, keeping its address', async () => {
    const store = createArtifactStore({ cwd, maxArtifacts: 2 });
    const seen: number[] = [];
    store.subscribe((artifact) => seen.push(artifact.version));
    const first = await store.publish({ title: 'Plan', content: '# v1', format: 'markdown', name: 'plan' });
    const second = await store.publish({ title: 'Plan 2', content: '# v2', format: 'markdown', name: 'plan' });
    expect(second).toMatchObject({ id: first.id, version: 2, title: 'Plan 2', kind: 'text' });
    expect(store.read(first.id)?.body.toString()).toBe('# v2');
    expect(seen).toEqual([1, 2]);
    // The oldest goes once there are too many.
    await store.publish({ title: 'B', content: 'b' });
    await store.publish({ title: 'C', content: 'c' });
    expect(store.list().map((artifact) => artifact.title)).toEqual(['B', 'C']);
    expect(store.read(first.id)).toBeUndefined();
  });

  it('answers with headers that keep the content away from the page showing it', async () => {
    const store = createArtifactStore({ cwd });
    const page = await store.publish({ title: 'Report "Q3"\r\nx', content: '<script>1</script>', format: 'html' });
    const html = artifactResponse(page, store.read(page.id)!.body).headers;
    expect(html['content-type']).toBe('text/html; charset=utf-8');
    const csp = html['content-security-policy'];
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain('sandbox allow-scripts');
    expect(csp).not.toContain('allow-same-origin');
    expect(csp).not.toMatch(/https?:|connect-src/);
    expect(html['x-content-type-options']).toBe('nosniff');
    expect(html['content-disposition']).toBe('inline; filename="Report-Q3-x.html"');

    const svg = await store.publish({ title: 'Chart', path: 'chart.svg' });
    // No `allow-scripts`: an SVG opened directly stays a picture.
    expect(artifactResponse(svg, Buffer.alloc(0)).headers['content-security-policy']).toMatch(/sandbox$/);
    const file = await store.publish({ title: 'Data', path: 'data.bin' });
    expect(artifactResponse(file, Buffer.alloc(0)).headers['content-disposition']).toBe(
      'attachment; filename="data.bin"',
    );
  });
});

describe('media artifacts', () => {
  it('types screenshots, audio and video, with a limit of their own', async () => {
    const store = createArtifactStore({ cwd, maxBytes: 20, maxMediaBytes: 50 });
    expect(await store.publish({ title: 'Shot', path: 'shot.png' })).toMatchObject({ kind: 'image' });
    // Over maxBytes, under maxMediaBytes.
    expect(await store.publish({ title: 'Beep', path: 'beep.mp3' })).toMatchObject({
      kind: 'audio',
      mimeType: 'audio/mpeg',
      bytes: 40,
    });
    expect(await store.publish({ title: 'Demo', path: 'demo.webm' })).toMatchObject({
      kind: 'video',
      mimeType: 'video/webm',
    });
    const small = createArtifactStore({ cwd, maxBytes: 5, maxMediaBytes: 30 });
    await expect(small.publish({ title: 'Beep', path: 'beep.mp3' })).rejects.toThrow(/Too large: 40 bytes/);
    // Media comes from files only.
    await expect(store.publish({ title: 'x', content: 'x', format: 'mp3' as unknown as 'text' })).rejects.toThrow(
      ArtifactError,
    );
  });

  it('drops the oldest content beyond the total kept in memory', async () => {
    const store = createArtifactStore({ cwd, maxTotalBytes: 45 });
    const shot = await store.publish({ title: 'Shot', path: 'shot.png' });
    const demo = await store.publish({ title: 'Demo', path: 'demo.webm' });
    await store.publish({ title: 'Beep', path: 'beep.mp3' });
    expect(store.list().map((artifact) => artifact.title)).toEqual(['Beep']);
    expect(store.read(shot.id)).toBeUndefined();
    expect(store.read(demo.id)).toBeUndefined();
    // The newest stays even when it alone is over the total.
    const tiny = createArtifactStore({ cwd, maxTotalBytes: 1 });
    await tiny.publish({ title: 'Beep', path: 'beep.mp3' });
    expect(tiny.list()).toHaveLength(1);
  });

  it('answers a Range with that part, so players can seek', async () => {
    const store = createArtifactStore({ cwd });
    const demo = await store.publish({ title: 'Demo', path: 'demo.webm' });
    const body = store.read(demo.id)!.body;
    const whole = artifactResponse(demo, body);
    expect(whole.status).toBe(200);
    expect(whole.headers['accept-ranges']).toBe('bytes');
    expect(whole.headers['content-security-policy']).toContain("media-src 'self'");
    expect(whole.headers['content-security-policy']).toMatch(/sandbox$/);

    const part = artifactResponse(demo, body, { range: 'bytes=2-5' });
    expect(part.status).toBe(206);
    expect(part.body.toString()).toBe('2345');
    expect(part.headers['content-range']).toBe('bytes 2-5/10');
    expect(part.headers['content-length']).toBe('4');
    expect(artifactResponse(demo, body, { range: 'bytes=7-' }).body.toString()).toBe('789');
    expect(artifactResponse(demo, body, { range: 'bytes=-3' }).body.toString()).toBe('789');
    expect(artifactResponse(demo, body, { range: 'bytes=8-99' }).headers['content-range']).toBe('bytes 8-9/10');

    const beyond = artifactResponse(demo, body, { range: 'bytes=10-' });
    expect(beyond.status).toBe(416);
    expect(beyond.headers['content-range']).toBe('bytes */10');
    // Several ranges, or nonsense: the whole content.
    expect(artifactResponse(demo, body, { range: 'bytes=0-1,4-5' }).status).toBe(200);
    expect(artifactResponse(demo, body, { range: 'lines=1-2' }).status).toBe(200);
  });
});

describe('artifact channel', () => {
  it('serves publish_artifact over MCP to the bearer only', async () => {
    const channel = await startArtifactChannel({ cwd });
    const server = channel.mcpServer as { name: string; url: string; headers: Record<string, string> };
    const call = (body: unknown, headers: Record<string, string> = server.headers) =>
      fetch(server.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      });
    try {
      expect(server.name).toBe('artifacts');
      expect((await call({}, {})).status).toBe(401);
      expect((await call({}, { ...server.headers, origin: 'http://evil.example' })).status).toBe(403);
      const list = (await (await call({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).json()) as {
        result: { tools: Array<{ name: string }> };
      };
      expect(list.result.tools.map((tool) => tool.name)).toEqual(['publish_artifact']);
      const publish = (args: unknown) =>
        call({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'publish_artifact', arguments: args },
        }).then(
          (response) => response.json() as Promise<{ result: { isError?: boolean; content: Array<{ text: string }> } }>,
        );
      const ok = await publish({ title: 'Report', path: 'report.html' });
      expect(ok.result.content[0].text).toContain('Published "Report"');
      expect(channel.store.list()).toHaveLength(1);
      const refused = await publish({ title: 'Env', path: '.env.local' });
      expect(refused.result.isError).toBe(true);
      expect(refused.result.content[0].text).toContain('cannot be published');
      expect(channel.store.list()).toHaveLength(1);
    } finally {
      await channel.close();
    }
  });
});

describe('session artifacts', () => {
  const mcpServer = { name: 'artifacts', url: 'http://127.0.0.1:1/mcp' };
  /** Publishes one artifact through `store` while its turn runs. */
  function publishingAgent(store: ReturnType<typeof createArtifactStore>, mcp: boolean) {
    const tasks: AgentTask[] = [];
    const agent: CodingAgent = {
      name: mcp ? 'with-mcp' : 'no-mcp',
      command: 'fake',
      capabilities: mcp ? { mcp: true } : {},
      run(task): AgentRun {
        tasks.push(task);
        const result = (async () => {
          await store.publish({ title: 'Report', path: 'report.html' });
          return { status: 'completed' as const, ok: true, exitCode: 0, signal: null };
        })();
        return {
          result,
          abort() {},
          async *[Symbol.asyncIterator]() {
            yield { type: 'done' as const, result: await result };
          },
        };
      },
    };
    return { agent, tasks };
  }

  it('gives MCP agents the server and records each publish in the running turn', async () => {
    const store = createArtifactStore({ cwd });
    const { agent, tasks } = publishingAgent(store, true);
    const other = { name: 'app', url: 'http://127.0.0.1:2/mcp' };
    const session = createAgentSession({ agent, cwd, artifacts: { store, mcpServer }, task: { mcpServers: [other] } });
    session.send('make a report');
    await session.idle();
    expect(tasks[0].mcpServers).toEqual([other, mcpServer]);
    expect(session.get().turns[0].entries).toEqual([
      { kind: 'artifact', artifact: expect.objectContaining({ title: 'Report', kind: 'html', version: 1 }) },
    ]);
    session.close();
    // A closed session no longer listens.
    await store.publish({ title: 'Late', content: 'x' });
    expect(session.get().turns[0].entries).toHaveLength(1);
  });

  it('leaves agents without MCP support alone', async () => {
    const store = createArtifactStore({ cwd });
    const { agent, tasks } = publishingAgent(store, false);
    const session = createAgentSession({ agent, cwd, artifacts: { store, mcpServer } });
    session.send('go');
    await session.idle();
    expect(tasks[0].mcpServers).toBeUndefined();
    session.close();
  });

  it("approves Claude's prompt for its own publish tool, and nothing else", async () => {
    const store = createArtifactStore({ cwd });
    const decisions: string[] = [];
    const agent: CodingAgent = {
      name: 'asks',
      command: 'fake',
      capabilities: { mcp: true },
      run(task): AgentRun {
        const result = (async () => {
          const ask = (tool: string) =>
            task.onApproval!({ id: tool, kind: 'other', detail: { tool_name: tool, input: {} } }, undefined);
          decisions.push(await ask('mcp__artifacts__publish_artifact'));
          void Promise.resolve(ask('mcp__other__publish_artifact')).then((decision) => decisions.push(decision));
          await new Promise((resolve) => setTimeout(resolve, 20));
          return { status: 'completed' as const, ok: true, exitCode: 0, signal: null };
        })();
        return {
          result,
          abort() {},
          async *[Symbol.asyncIterator]() {
            yield { type: 'done' as const, result: await result };
          },
        };
      },
    };
    const session = createAgentSession({ agent, cwd, artifacts: { store, mcpServer } });
    session.send('go');
    await expect
      .poll(() => session.get().approvals.map((request) => request.id))
      .toEqual(['mcp__other__publish_artifact']);
    expect(decisions).toEqual(['approve']);
    await session.idle();
    expect(decisions).toEqual(['approve', 'deny']);
    session.close();
  });
  it('tells the agent that takes over what was published, with content that exists nowhere else', async () => {
    const work = mkdtempSync(join(root, 'handoff-'));
    writeFileSync(join(work, 'report.html'), '<h1>Report</h1>');
    const store = createArtifactStore({ cwd: work });
    const agentThat = (name: string, during: () => Promise<unknown>) => {
      const tasks: AgentTask[] = [];
      const agent: CodingAgent = {
        name,
        command: 'fake',
        capabilities: { mcp: true },
        run(task): AgentRun {
          tasks.push(task);
          const result = (async () => {
            await during();
            return { status: 'completed' as const, ok: true, exitCode: 0, signal: null, text: 'done' };
          })();
          return {
            result,
            abort() {},
            async *[Symbol.asyncIterator]() {
              yield { type: 'done' as const, result: await result };
            },
          };
        },
      };
      return { agent, tasks };
    };
    const first = agentThat('claude', async () => {
      await store.publish({ title: 'Survey', name: 'survey', content: '<form>v1</form>', format: 'html' });
      await store.publish({ title: 'Survey', name: 'survey', content: '<form>v2 ```</form>', format: 'html' });
      await store.publish({ title: 'Report', path: 'report.html' });
    });
    const second = agentThat('codex', async () => {
      // The same store: the next agent replaces the artifact under its name.
      await store.publish({ title: 'Survey', name: 'survey', content: '<form>v3</form>', format: 'html' });
    });
    const session = createAgentSession({ agent: first.agent, cwd: work, artifacts: { store, mcpServer } });
    session.send('ask me');
    await session.idle();
    const card = session.get().turns[0].entries.at(-2);
    session.setAgent(second.agent);
    session.send('change the survey');
    await session.idle();

    expect(second.tasks[0].mcpServers).toEqual([mcpServer]);
    const prompt = second.tasks[0].prompt;
    expect(prompt).toContain('- "Survey" (name: `survey`, html, version 2)');
    expect(prompt).toContain('- "Report" (name: `report.html`, html, from `report.html`)');
    const transcript = readFileSync(join(work, session.get().turns[1].handoff!.file!), 'utf8');
    // The latest version only, fenced past the backticks inside; files stay on disk.
    expect(transcript).not.toContain('<form>v1</form>');
    expect(transcript).toContain('````\n<form>v2 ```</form>\n````');
    expect(transcript).not.toContain('<h1>Report</h1>');
    // Same address for the card of the earlier turn.
    const replaced = session.get().turns[1].entries.find((entry) => entry.kind === 'artifact');
    expect(replaced).toMatchObject({
      artifact: { version: 3, id: (card as { artifact: { id: string } }).artifact.id },
    });
    session.close();
  });
  it('tells the fallback what the agent that ran out had already published', async () => {
    const work = mkdtempSync(join(root, 'failover-'));
    const store = createArtifactStore({ cwd: work });
    const prompts: string[] = [];
    const agentThat = (name: string, during: () => Promise<Partial<AgentResult>>): CodingAgent => ({
      name,
      command: 'fake',
      capabilities: { mcp: true },
      run(task): AgentRun {
        if (name === 'codex') prompts.push(task.prompt);
        const result = (async () => ({
          status: 'completed' as const,
          ok: true,
          exitCode: 0,
          signal: null,
          ...(await during()),
        }))();
        return {
          result,
          abort() {},
          async *[Symbol.asyncIterator]() {
            yield { type: 'done' as const, result: await result };
          },
        };
      },
    });
    const claude = agentThat('claude', async () => {
      await store.publish({ title: 'Survey', name: 'survey', content: '<form>v1</form>', format: 'html' });
      return { status: 'failed', ok: false, exitCode: 1, failure: { kind: 'quota' } };
    });
    const codex = agentThat('codex', async () => ({ text: 'done' }));
    const session = createAgentSession({
      agent: claude,
      fallback: [codex],
      cwd: work,
      artifacts: { store, mcpServer },
    });
    session.send('ask me');
    await session.idle();

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('claude stopped part-way through this request (quota).');
    expect(prompts[0]).toContain('- "Survey" (name: `survey`, html)');
    expect(prompts[0]).toMatch(/ask me$/);
    const file = /is in `([^`]+\.handoff\.md)`/.exec(prompts[0])![1];
    expect(readFileSync(join(work, file), 'utf8')).toContain('```\n<form>v1</form>\n```');
    session.close();
  });
});
