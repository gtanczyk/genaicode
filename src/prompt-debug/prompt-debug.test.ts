import { describe, it, vi } from 'vitest';
import { generateContent as generateContentGemini } from '../ai-service/ai-studio.js';
import { generateContent as generateContentGPT } from '../ai-service/openai.js';
import { generateContent as generateContentClaude } from '../ai-service/anthropic.js';
import { getFunctionDefs } from '../prompt/function-calling.js';
import { validateAndRecoverSingleResult } from '../prompt/steps/step-validate-recover.js';
import { DEBUG_CURRENT_PROMPT } from './current-prompt.js';
import { PromptItem } from '../ai-service/common-types.js';
import { ModelType, GenerateContentArgs, GenerateContentResult } from '../ai-service/common-types.js';
import { updateServiceConfig } from '../ai-service/service-configurations.js';

vi.setConfig({
  testTimeout: 60000,
});

describe('prompt-debug', () => {
  const prompt = DEBUG_CURRENT_PROMPT as PromptItem[];
  const requiredFunctionName = 'setSummaries';
  const temperature = 0.2;
  const functionDefs = getFunctionDefs();
  const baseOptions = {
    disableCache: false,
    askQuestion: false,
  };

  it('Gemini Flash', async () => {
    const config: GenerateContentArgs[1] = {
      functionDefs,
      requiredFunctionName,
      temperature,
      modelType: ModelType.LITE,
    };
    const options: GenerateContentArgs[2] = { ...baseOptions };
    let result: GenerateContentResult = await generateContentGemini(prompt, config, options);
    result = await validateAndRecoverSingleResult([prompt, config, options], result, generateContentGemini);

    const geminiArgs = result.filter((item) => item.type === 'functionCall')[0].functionCall.args;

    console.log('GEMINI', JSON.stringify(geminiArgs, null, 4));
  });

  it('GPT Mini', async () => {
    const config: GenerateContentArgs[1] = {
      functionDefs,
      requiredFunctionName,
      temperature,
      modelType: ModelType.CHEAP,
    };
    const options: GenerateContentArgs[2] = { ...baseOptions };
    let result: GenerateContentResult = await generateContentGPT(prompt, config, options);
    result = await validateAndRecoverSingleResult([prompt, config, options], result, generateContentGPT);

    console.log('GPT', JSON.stringify(result, null, 4));
  });

  it('Claude Haikku', async () => {
    const config: GenerateContentArgs[1] = {
      functionDefs,
      requiredFunctionName,
      temperature,
      modelType: ModelType.CHEAP,
    };
    const options: GenerateContentArgs[2] = {
      ...baseOptions,
      aiService: 'anthropic',
    };
    let result: GenerateContentResult = await generateContentClaude(prompt, config, options);
    result = await validateAndRecoverSingleResult([prompt, config, options], result, generateContentClaude);

    console.log(
      'CLAUDE',
      JSON.stringify(result.filter((item) => item.type === 'functionCall')[0].functionCall.args, null, 4),
    );
  });

  it('Gemini Pro', async () => {
    updateServiceConfig('ai-studio', {
      modelOverrides: {
        default: 'gemini-3-pro-preview',
      },
      apiKey: process.env.API_KEY,
    });
    const config: GenerateContentArgs[1] = {
      functionDefs,
      requiredFunctionName,
      temperature,
      modelType: ModelType.DEFAULT,
    };
    const options: GenerateContentArgs[2] = { ...baseOptions };

    let result: GenerateContentResult = await generateContentGemini(prompt, config, options);
    result = await validateAndRecoverSingleResult([prompt, config, options], result, generateContentGemini);

    console.log(
      'GEMINI',
      JSON.stringify(result.filter((item) => item.type === 'functionCall')[0].functionCall.args, null, 4),
    );
  });

  it('GPT 4o', async () => {
    const config: GenerateContentArgs[1] = {
      functionDefs,
      requiredFunctionName,
      temperature,
      modelType: ModelType.DEFAULT,
    };
    const options: GenerateContentArgs[2] = { ...baseOptions };
    const result = await generateContentGPT(prompt, config, options);
    const gptArgs = result.filter((item) => item.type === 'functionCall')[0].functionCall.args;

    console.log('GPT', JSON.stringify(gptArgs, null, 4));
  });

  it('DeepSeek', async () => {
    updateServiceConfig('openai', {
      modelOverrides: {
        default: 'deepseek-chat',
        cheap: 'deepseek-chat',
      },
      apiKey: process.env.DEEPSEEK_API_KEY,
      openaiBaseUrl: 'https://api.deepseek.com',
    });

    const config: GenerateContentArgs[1] = {
      functionDefs,
      requiredFunctionName,
      temperature,
      modelType: ModelType.DEFAULT,
    };
    const options: GenerateContentArgs[2] = { ...baseOptions };
    let result: GenerateContentResult = await generateContentGPT(prompt, config, options);
    result = await validateAndRecoverSingleResult([prompt, config, options], result, generateContentGPT);

    const gptArgs = result.filter((item) => item.type === 'functionCall')[0].functionCall.args;

    console.log('DeepSeek', JSON.stringify(gptArgs, null, 4));
  });

  it('Grok', async () => {
    updateServiceConfig('openai', {
      modelOverrides: {
        default: 'grok-beta',
        cheap: 'grok-beta',
      },
      apiKey: process.env.GROK_OPENAI_API_KEY,
      openaiBaseUrl: 'https://api.x.ai/v1',
    });

    const config: GenerateContentArgs[1] = {
      functionDefs,
      requiredFunctionName,
      temperature,
      modelType: ModelType.DEFAULT,
    };
    const options: GenerateContentArgs[2] = { ...baseOptions };
    const grokPrompt = prompt.map((item) => ({ ...item, text: item.text ?? ' ' }));
    let result: GenerateContentResult = await generateContentGPT(grokPrompt, config, options);
    result = await validateAndRecoverSingleResult([grokPrompt, config, options], result, generateContentGPT);

    const gptArgs = result.filter((item) => item.type === 'functionCall')[0].functionCall.args;

    console.log('Grok', JSON.stringify(gptArgs, null, 4));
  });

  it('Claude Sonnet', async () => {
    const config: GenerateContentArgs[1] = {
      functionDefs,
      requiredFunctionName,
      temperature,
      modelType: ModelType.DEFAULT,
    };
    const options: GenerateContentArgs[2] = { ...baseOptions };

    const result = (await generateContentClaude(prompt, config, options)).filter(
      (item) => item.type === 'functionCall',
    );
    const claudeArgs = result[0].functionCall.args;

    console.log('CLAUDE', JSON.stringify(claudeArgs, null, 4));
  });
});
