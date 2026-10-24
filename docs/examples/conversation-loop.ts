import { genaicode, system } from 'genaicode';
import { openai } from 'genaicode/providers';

const ai = genaicode(openai({ model: process.env.OPENAI_MODEL ?? 'your-model-name' }));
const conversation = ai.chain(system('Improve the draft while preserving its meaning.'));

let draft = 'The deployment had a problem and we fixed it.';

for (const instruction of ['Make it specific.', 'Make it concise.', 'Use a professional tone.']) {
  draft = await conversation.text(`${instruction}\n\nCurrent draft:\n${draft}`);
}

console.log(draft);
