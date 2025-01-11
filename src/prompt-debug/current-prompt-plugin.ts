import fs from 'fs';
import { Plugin } from '../index.js';

const currentPromptPlugin: Plugin = {
  name: 'current-prompt-plugin',
  // Example implementation of generateContent hooks
  generateContentHook: async ([prompt]): Promise<void> => {
    fs.writeFileSync(
      './src/prompt-debug/current-prompt.js',
      'export const DEBUG_CURRENT_PROMPT = ' + JSON.stringify(prompt, null, 2) + ';',
    );
  },
};

export default currentPromptPlugin;
