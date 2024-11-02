import { describe, it, vi } from 'vitest';
import { generateContent as generateContentClaude } from '../ai-service/anthropic';
import { getFunctionDefs } from '../prompt/function-calling.js';
import { PromptItem } from '../ai-service/common';
import { getSystemPrompt } from '../prompt/systemprompt.js';
import {
  INITIAL_GREETING,
  REQUEST_SOURCE_CODE,
  SOURCE_CODE_RESPONSE,
  READY_TO_ASSIST,
} from '../prompt/static-prompts.js';
import { PLANNING_PROMPT } from '../prompt/steps/step-codegen-planning';

vi.setConfig({
  testTimeout: 60000,
});

describe('codegen-summary', () => {
  const temperature = 0.2;

  describe('Claude Haikku - simple task', () => {
    it('should generate a valid codegenSummary response', async () => {
      // Build the prompt items that simulate the full conversation context
      const prompt: PromptItem[] = [
        // System prompt
        {
          type: 'systemPrompt',
          systemPrompt: getSystemPrompt({ aiService: 'anthropic' }),
        },
        // Initial greeting
        { type: 'user', text: INITIAL_GREETING },
        // Assistant asks for context
        {
          type: 'assistant',
          text: REQUEST_SOURCE_CODE,
          functionCalls: [{ name: 'getSourceCode' }],
        },
        // User provides source code
        {
          type: 'user',
          functionResponses: [
            {
              name: 'getSourceCode',
              content: JSON.stringify({
                '/path/to/file': {
                  'translator.ts': {
                    summary:
                      'This file contains a translator function, and should be used if there is a need to translate text.',
                  },
                  'example.ts': {
                    content: 'console.log("Hello");',
                  },
                },
              }),
            },
          ],
          text: SOURCE_CODE_RESPONSE,
        },
        // Assistant acknowledges
        {
          type: 'assistant',
          text: READY_TO_ASSIST,
        },
        // User provides the task
        {
          type: 'user',
          text: 'example.ts should output "Hello" dynamically translated to Japanese',
        },
        {
          type: 'assistant',
          text: 'I will generate a plan to achieve this task.',
        },
        { type: 'user', text: PLANNING_PROMPT },
      ];

      // Call Claude Haikku with codegenSummary
      let claudeResponse = await generateContentClaude(
        prompt,
        getFunctionDefs(),
        'codegenPlanning',
        temperature,
        true,
        {
          aiService: 'anthropic',
          disableCache: false,
        },
      );

      // Get the codegenPlanning from response
      const codegenPlanning = claudeResponse.find((call) => call.name === 'codegenPlanning');
      console.log('Claude Haikku codegenPlanning:', JSON.stringify(codegenPlanning?.args, null, 2));

      prompt.push({ type: 'assistant', functionCalls: claudeResponse });
      prompt.push({
        type: 'user',
        functionResponses: claudeResponse.map((call) => ({ name: call.name, call_id: call.id })),
        text: 'Planning phase completed. Please proceed with code generation.',
        cache: true,
      });

      // Call Claude Haikku with codegenSummary
      claudeResponse = await generateContentClaude(prompt, getFunctionDefs(), 'codegenSummary', temperature, true, {
        aiService: 'anthropic',
        disableCache: false,
      });

      // Get the codegenSummary from response
      const codegenSummary = claudeResponse.find((call) => call.name === 'codegenSummary');
      console.log('Claude Haikku codegenSummary:', JSON.stringify(codegenSummary?.args, null, 2));
    });
  });
});
