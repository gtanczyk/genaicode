import fs from 'fs';
import { Plugin } from '../../src/index.js';

const currentPromptPlugin: Plugin = {
  name: 'current-prompt-plugin',
  // Example implementation of generateContent hooks
  generateContentHook: async ([prompt]): Promise<void> => {
    fs.writeFileSync(
      './src/eval/data/current-prompt.js',
      'export const DEBUG_CURRENT_PROMPT = ' + JSON.stringify(prompt, null, 2) + ';',
    );
  },
};

export default currentPromptPlugin;
