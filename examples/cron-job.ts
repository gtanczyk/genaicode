import { cachePlugin, genaicode, rateLimitPlugin, system, timingPlugin } from 'genaicode';
import { openai } from 'genaicode/providers';

/**
 * Cron-style batch job: rate-limited, timed, and cached repeated prompts.
 * Wire this from your scheduler (node-cron, systemd timer, Cloud Scheduler, etc.).
 */
const ai = genaicode(openai({ model: process.env.OPENAI_MODEL ?? 'your-model-name' }), {
  plugins: [
    timingPlugin(),
    rateLimitPlugin({ concurrency: 2, minIntervalMs: 100 }),
    cachePlugin({ maxEntries: 32 }),
  ],
});

const reports = ['api latency rose 20%', 'error budget burned 8%', 'checkout conversion stable'];

export async function runNightlyDigest(): Promise<string> {
  const bullets: string[] = [];
  for (const report of reports) {
    bullets.push(
      await ai.prompt(system('Rewrite as one executive bullet.'), report).text(),
    );
  }
  return bullets.map((bullet) => `- ${bullet}`).join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(await runNightlyDigest());
}
