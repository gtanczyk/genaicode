import { describe, expect, it } from 'vitest';
import { genaicode } from './index.js';
import type { RequestBuilder } from './index.js';
import { anthropic, gemini, openai } from './providers.js';

const hasOpenAI = Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL);
const hasAnthropic = Boolean(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_MODEL);
const hasGemini = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_MODEL);

const itIf = (condition: boolean) => (condition ? it : it.skip);
const hasQuotaError = (error: unknown): boolean =>
  error instanceof Error &&
  (error.message.includes('insufficient_quota') ||
    error.message.includes('exceeded your current quota') ||
    error.message.includes('429'));

async function runSmokeRequest(request: RequestBuilder) {
  const result = await request
    .system('Return plain text only and follow the user instruction exactly.')
    .temperature(0)
    .maxOutputTokens(50)
    .run();
  expect(Array.isArray(result.parts)).toBe(true);
}

describe('provider e2e', () => {
  itIf(hasOpenAI)('calls OpenAI with real credentials', { timeout: 60_000 }, async () => {
    try {
      const ai = genaicode(
        openai({
          apiKey: process.env.OPENAI_API_KEY,
          model: process.env.OPENAI_MODEL,
        }),
      );
      await runSmokeRequest(ai('What is 2 + 2? Reply with exactly "4".'));
    } catch (error) {
      if (hasQuotaError(error)) return;
      throw error;
    }
  });

  itIf(hasAnthropic)('calls Anthropic with real credentials', { timeout: 60_000 }, async () => {
    const ai = genaicode(
      anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
        model: process.env.ANTHROPIC_MODEL,
      }),
    );
    await runSmokeRequest(ai('What is 2 + 2? Reply with exactly "4".'));
  });

  itIf(hasGemini)('calls Gemini with real credentials', { timeout: 60_000 }, async () => {
    const ai = genaicode(
      gemini({
        apiKey: process.env.GEMINI_API_KEY,
        model: process.env.GEMINI_MODEL,
      }),
    );
    await runSmokeRequest(ai('What is 2 + 2? Reply with exactly "4".'));
  });
});
