import { genaicode, system } from 'genaicode';
import { openai } from 'genaicode/providers';

const ai = genaicode(
  openai({
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL ?? 'your-model-name',
  }),
  { temperature: 0.2 },
);

const summarize = (text: string) =>
  ai.prompt(
    system('Summarize backend incidents for an engineering audience.'),
    `Summarize this incident in three bullets:\n\n${text}`,
  );

console.log(await summarize('The database connection pool was exhausted for 12 minutes.').text());
