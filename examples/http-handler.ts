import http from 'node:http';
import { genaicode, system } from 'genaicode';
import { openai } from 'genaicode/providers';

/**
 * Minimal HTTP handler example.
 *
 * POST /summarize  body: { "text": "..." }
 * Returns plain text.
 */
const ai = genaicode(openai({ model: process.env.OPENAI_MODEL ?? 'your-model-name' }), {
  temperature: 0.2,
});

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/summarize') {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { text?: string };
    const summary = await ai
      .prompt(system('Summarize for engineers in three bullets.'), body.text ?? '')
      .text();
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(summary);
    return;
  }

  res.writeHead(404).end('Not found');
});

const port = Number(process.env.PORT ?? 8787);
server.listen(port, () => {
  console.log(`Listening on http://localhost:${port}`);
});
