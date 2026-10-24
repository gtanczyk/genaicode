import { genaicode, system, withRetry } from 'genaicode';
import { openai } from 'genaicode/providers';

type Job = { id: string; text: string };

/**
 * Queue-worker style loop: pull a job, call the model, acknowledge.
 * Retries are explicit and application-owned via `withRetry`.
 */
const ai = genaicode(openai({ model: process.env.OPENAI_MODEL ?? 'your-model-name' }));

async function handleJob(job: Job): Promise<string> {
  return withRetry(
    () =>
      ai
        .prompt(system('Classify the support ticket as billing, bug, or question.'), job.text)
        .text(),
    { attempts: 3, delayMs: 200 },
  );
}

// Stand-in for a queue client.
async function* pullJobs(): AsyncGenerator<Job> {
  yield { id: 'job-1', text: 'I was charged twice for last month.' };
}

for await (const job of pullJobs()) {
  const label = await handleJob(job);
  console.log(job.id, label);
}
