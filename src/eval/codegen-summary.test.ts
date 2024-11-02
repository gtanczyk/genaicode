import { describe, it, vi, expect } from 'vitest';
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
          text: 'Please add a new function that prints "World"',
        },
      ];

      // Call Claude Haikku with codegenSummary
      const claudeResponse = await generateContentClaude(
        prompt,
        getFunctionDefs(),
        'codegenSummary',
        temperature,
        true,
        {
          aiService: 'anthropic',
          disableCache: false,
        },
      );

      // Get the codegenSummary from response
      const codegenSummary = claudeResponse.find((call) => call.name === 'codegenSummary');
      console.log('Claude Haikku codegenSummary:', JSON.stringify(codegenSummary?.args, null, 2));

      // Basic structure validation
      expect(codegenSummary).toBeDefined();
      expect(codegenSummary?.args).toHaveProperty('explanation');
      expect(codegenSummary?.args).toHaveProperty('fileUpdates');
      expect(codegenSummary?.args).toHaveProperty('contextPaths');

      // Content validation
      const { explanation, fileUpdates, contextPaths } = codegenSummary!.args as {
        explanation: string;
        fileUpdates: Record<string, unknown>[];
        contextPaths: string[];
      };

      // Explanation should be a non-empty string
      expect(typeof explanation).toBe('string');
      expect(explanation.length).toBeGreaterThan(0);

      // FileUpdates should be an array with at least one update
      expect(Array.isArray(fileUpdates)).toBe(true);
      expect(fileUpdates.length).toBeGreaterThan(0);

      // Each file update should have required properties
      fileUpdates.forEach((update) => {
        expect(update).toHaveProperty('filePath');
        expect(update).toHaveProperty('updateToolName');
        expect(update).toHaveProperty('prompt');
      });

      // ContextPaths should be an array
      expect(Array.isArray(contextPaths)).toBe(true);
    });
  });
});
