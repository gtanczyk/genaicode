import { describe, it, vi } from 'vitest';
// import assert from 'node:assert';
import { generateContent as generateContentGemini } from '../ai-service/ai-studio';
import { generateContent as generateContentGPT } from '../ai-service/chat-gpt';
import { generateContent as generateContentClaude } from '../ai-service/anthropic';
import * as debugPrompts from './data/prompt3.js';
import { getFunctionDefs } from '../prompt/function-calling.js';
import { PromptItem } from '../ai-service/common';
// import { validateAndRecoverSingleResult } from '../prompt/steps/step-validate-recover';

vi.setConfig({
  testTimeout: 60000,
});

describe('prompt-debug', () => {
  const prompt = debugPrompts.DEBUG_PROMPT3 as PromptItem[];
  const requiredFunctionName = 'codegenSummary';
  const temperature = 0.2;

  it('Gemini Flash', async () => {
    const geminiArgs = (
      await generateContentGemini(prompt, getFunctionDefs(), requiredFunctionName, temperature, true, {
        aiService: 'vertex-ai',
      })
    )[0].args;

    console.log('GEMINI', geminiArgs);
  });

  it('GPT Mini', async () => {
    const gptArgs = (await generateContentGPT(prompt, getFunctionDefs(), requiredFunctionName, temperature, true))[0]
      .args;

    console.log('GPT', gptArgs);
  });

  it('Claude Haikku', async () => {
    const claudeArgs = (
      await generateContentClaude(prompt, getFunctionDefs(), requiredFunctionName, temperature, true, {
        aiService: 'anthropic',
        disableCache: false,
      })
    )[0].args;

    console.log('CLAUDE', claudeArgs);
  });

  it('Gemini Pro', async () => {
    const geminiArgs = (
      await generateContentGemini(prompt, getFunctionDefs(), requiredFunctionName, temperature, false, {
        aiService: 'vertex-ai',
      })
    )[0].args;

    console.log('GEMINI', geminiArgs);
  });

  it('GPT 4o', async () => {
    const gptArgs = (await generateContentGPT(prompt, getFunctionDefs(), requiredFunctionName, temperature, false))[0]
      .args;

    console.log('GPT', gptArgs);
  });

  it('Claude Sonnet', async () => {
    const claudeArgs = (
      await generateContentClaude(prompt, getFunctionDefs(), requiredFunctionName, temperature, false, {
        aiService: 'anthropic',
        disableCache: false,
      })
    )[0].args;

    console.log('CLAUDE', claudeArgs);
  });
});
