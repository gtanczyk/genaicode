import { describe, it, expect, vi } from 'vitest';
import { generateContent as generateContentAiStudio } from '../ai-service/ai-studio.js';
import { OPTIMIZATION_PROMPT, OPTIMIZATION_TRIGGER_PROMPT } from '../prompt/steps/step-context-optimization.js';
import { getFunctionDefs } from '../prompt/function-calling.js';
import { PromptItem } from '../ai-service/common.js';
import { getSystemPrompt } from '../prompt/systemprompt.js';
import { mockSourceCodeTreeSummaries } from './data/mock-source-code-summaries.js';
import {
  INITIAL_GREETING,
  READY_TO_ASSIST,
  REQUEST_SOURCE_CODE,
  SOURCE_CODE_RESPONSE,
} from '../prompt/static-prompts.js';

vi.setConfig({
  testTimeout: 60000,
});

describe('Context optimization', () => {
  it('Should optimize context for math module unit test', async () => {
    // Prepare prompt items for optimization
    const prompt: PromptItem[] = [
      {
        type: 'systemPrompt',
        systemPrompt: getSystemPrompt({ aiService: 'ai-studio', askQuestion: true, ui: true }),
      },
      { type: 'user', text: INITIAL_GREETING },
      {
        type: 'assistant',
        text: REQUEST_SOURCE_CODE,
        functionCalls: [{ name: 'getSourceCode' }],
      },
      {
        type: 'user',
        text: SOURCE_CODE_RESPONSE,
        functionResponses: [
          {
            name: 'getSourceCode',
            content: JSON.stringify(mockSourceCodeTreeSummaries),
          },
        ],
      },
      {
        type: 'assistant',
        text: READY_TO_ASSIST,
      },
      {
        type: 'user',
        text: "Let's add a unit test for the math module",
      },
      {
        type: 'assistant',
        text: OPTIMIZATION_TRIGGER_PROMPT,
      },
      {
        type: 'user',
        text: OPTIMIZATION_PROMPT,
      },
    ];

    // Execute context optimization
    const [optimizeContextCall] = await generateContentAiStudio(
      prompt,
      getFunctionDefs(),
      'optimizeContext',
      0.2,
      true,
      {
        aiService: 'ai-studio',
        askQuestion: false,
      },
    );

    // Verify optimization results
    expect(optimizeContextCall).toBeDefined();
    expect(optimizeContextCall?.args?.optimizedContext).toBeDefined();

    const optimizedContext = optimizeContextCall?.args?.optimizedContext as Array<{
      filePath: string;
      relevance: number;
    }>;
    const optimizedFiles = optimizedContext.map((item) => item.filePath);
    const minRelevancy = optimizedContext.reduce((min, item) => Math.min(min, item.relevance), 1);

    expect(optimizedFiles).toEqual(['/project/src/math/math.ts', '/project/src/math/math-utils.ts']);
    expect(minRelevancy).toBeGreaterThan(0.5);
  });
});
