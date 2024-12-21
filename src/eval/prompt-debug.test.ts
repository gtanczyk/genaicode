import { describe, it, vi } from 'vitest';
import { generateContent as generateContentGemini } from '../ai-service/ai-studio';
import { generateContent as generateContentGPT } from '../ai-service/chat-gpt';
import { generateContent as generateContentClaude } from '../ai-service/anthropic';
import { generateContent as generateContentVertexClaude } from '../ai-service/vertex-ai-claude';
import { getFunctionDefs } from '../prompt/function-calling.js';
import { validateAndRecoverSingleResult } from '../prompt/steps/step-validate-recover';
import { DEBUG_CURRENT_PROMPT } from './data/current-prompt';
import { PromptItem } from '../ai-service/common';
import { updateServiceConfig } from '../ai-service/service-configurations';

vi.setConfig({
  testTimeout: 60000,
});

describe('prompt-debug', () => {
  const prompt = DEBUG_CURRENT_PROMPT as PromptItem[];
  const requiredFunctionName = 'optimizeContext';
  const temperature = 0.7;

  it('Gemini Flash', async () => {
    updateServiceConfig('ai-studio', {
      modelOverrides: {
        cheap: 'gemini-2.0-flash-exp',
      },
      apiKey: process.env.API_KEY,
    });
    const geminiArgs = (
      await generateContentGemini(prompt, getFunctionDefs(), requiredFunctionName, temperature, true, {
        aiService: 'ai-studio',
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
    const defs = getFunctionDefs(); //.filter((fd) => fd.name === 'askQuestion');
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

  it('Claude Haikku (Vertex)', async () => {
    const defs = getFunctionDefs(); //.filter((fd) => fd.name === 'askQuestion');
    const req = [prompt, defs, requiredFunctionName, temperature, true] as const;
    let result = await generateContentVertexClaude(...req);
    result = await validateAndRecoverSingleResult(
      [
        ...req,
        {
          aiService: 'vertex-ai-claude',
          disableCache: false,
          askQuestion: false,
        },
      ],
      result,
      generateContentVertexClaude,
    );

    console.log('CLAUDE VERTEX', JSON.stringify(result[0].args, null, 4));
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

  it('Claude Sonnet (Vertex)', async () => {
    const claudeArgs = (
      await generateContentVertexClaude(prompt, getFunctionDefs(), requiredFunctionName, temperature, false)
    )[0].args;

    console.log('CLAUDE VERTEX', JSON.stringify(claudeArgs, null, 4));
  });
});
