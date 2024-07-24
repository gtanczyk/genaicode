import assert from 'node:assert';

import { CODEGEN_TRIGGER } from './prompt-consts.js';
import { codegenOnly, gameOnly, verbosePrompt } from '../cli/cli-params.js';
import { verifySystemPromptLimit } from './limits.js';

/** Generates a system prompt */
export function getSystemPrompt() {
  console.log('Generate system prompt');

  assert(!codegenOnly || !gameOnly, 'codegenOnly and gameOnly cannot be true at the same time');

  let systemPrompt = `
  I want you to help me generate code for my ideas in my application the source code have been given:
  ${gameOnly ? '' : `- /codegen: node.js script that helps me generate code using Vertex AI, it is using javascript`}
  ${codegenOnly ? '' : `- /src: React application that will run in a browser, it is using typescript`}
  - /docs: Directory which contains description of the application

  You can generate new code, or modify the existing one. You will receive instructions on what is the goal of requested code modification.

  Instructions will be passed to you either directly via message, with a file, or using the ${CODEGEN_TRIGGER} comment in the code.

  Parse my application source code and make changes.
  `;

  if (verbosePrompt) {
    console.log('System prompt:');
    console.log(systemPrompt);
  }

  verifySystemPromptLimit(systemPrompt);

  return systemPrompt;
}
