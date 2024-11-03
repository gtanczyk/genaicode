import fs from 'fs';

export const DEBUG_CURRENT_PROMPT = JSON.parse(fs.readFileSync('./src/eval/data/current-prompt.json', 'utf-8'));
