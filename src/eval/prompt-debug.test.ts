import { describe, it, vi } from 'vitest';
import { generateContent as generateContentGemini } from '../ai-service/ai-studio';
import { generateContent as generateContentGPT } from '../ai-service/chat-gpt';
import { generateContent as generateContentClaude } from '../ai-service/anthropic';
// import * as debugPrompts from './data/prompt4';
import { getFunctionDefs } from '../prompt/function-calling.js';
// import { PromptItem } from '../ai-service/common';
import { validateAndRecoverSingleResult } from '../prompt/steps/step-validate-recover';
import { DEBUG_CURRENT_PROMPT } from './data/current-prompt';
import { PromptItem } from '../ai-service/common';

vi.setConfig({
  testTimeout: 60000,
});

describe('prompt-debug', () => {
  const prompt = DEBUG_CURRENT_PROMPT as PromptItem[];
  const requiredFunctionName = 'askQuestion';
  const temperature = 0.7;

  it('Gemini Flash', async () => {
    const geminiArgs = (
      await generateContentGemini(prompt, getFunctionDefs(), requiredFunctionName, temperature, true, {
        aiService: 'vertex-ai',
        askQuestion: false,
      })
    )[0].args;

    console.log('GEMINI', JSON.stringify(geminiArgs, null, 4));
  });

  it('GPT Mini', async () => {
    const req = [prompt, getFunctionDefs(), requiredFunctionName, temperature, true] as const;
    let result = await generateContentGPT(...req);
    result = await validateAndRecoverSingleResult(
      [
        ...req,
        {
          aiService: 'chat-gpt',
          disableCache: false,
          askQuestion: false,
        },
      ],
      result,
      generateContentGPT,
    );

    console.log('GPT', JSON.stringify(result, null, 4));
  });

  it('Claude Haikku', async () => {
    const defs = getFunctionDefs();
    const req = [
      prompt,
      defs,
      requiredFunctionName,
      temperature,
      true,
      {
        aiService: 'anthropic',
        disableCache: false,
        askQuestion: false,
      },
    ] as const;
    let result = await generateContentClaude(...req);
    result = await validateAndRecoverSingleResult([...req], result, generateContentClaude);

    console.log('CLAUDE', JSON.stringify(result[0].args, null, 4));
  });

  it('Gemini Pro', async () => {
    const geminiArgs = (
      await generateContentGemini(prompt, getFunctionDefs(), requiredFunctionName, temperature, false, {
        aiService: 'vertex-ai',
        askQuestion: false,
      })
    )[0].args;

    console.log('GEMINI', JSON.stringify(geminiArgs, null, 4));
  });

  it('GPT 4o', async () => {
    const gptArgs = (await generateContentGPT(prompt, getFunctionDefs(), requiredFunctionName, temperature, false))[0]
      .args;

    console.log('GPT', JSON.stringify(gptArgs, null, 4));
  });

  it('Claude Sonnet', async () => {
    const claudeArgs = (
      await generateContentClaude(prompt, getFunctionDefs(), requiredFunctionName, temperature, false, {
        aiService: 'anthropic',
        disableCache: false,
        askQuestion: false,
      })
    )[0].args;

    console.log('CLAUDE', JSON.stringify(claudeArgs, null, 4));
  });
});
