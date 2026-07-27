import { describe, expect, it } from 'vitest';
import { genaicode } from './index.js';
import type { GenAIClient, RequestBuilder } from './index.js';
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

async function withQuotaSkip(run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    if (hasQuotaError(error)) return;
    throw error;
  }
}

async function runSmokeRequest(request: RequestBuilder) {
  const result = await request
    .system('Return plain text only and follow the user instruction exactly.')
    .temperature(0)
    .maxOutputTokens(50)
    .run();
  expect(Array.isArray(result.parts)).toBe(true);
}

async function runJsonResponseFormat(ai: GenAIClient) {
  const maxAttempts = 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const value = await ai('Return a JSON object with a single key "answer" whose value is the number 4.')
        .system('Respond with JSON only. Do not include markdown fences or commentary.')
        .responseFormat({ type: 'json' })
        // Keep thinking cheap so a small token budget is not spent only on thoughts.
        .thinking(false)
        .temperature(0)
        .maxOutputTokens(256)
        .json((parsed) => {
          if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            throw new Error(`expected object, got ${typeof parsed}`);
          }
          return parsed as { answer?: unknown };
        });

      const answer = value.answer;
      expect(answer === 4 || answer === '4').toBe(true);
      return;
    } catch (error) {
      lastError = error;
      if (hasQuotaError(error) || attempt === maxAttempts) throw error;
    }
  }

  throw lastError;
}

async function runThinkingDisabled(ai: GenAIClient) {
  const text = await ai('What is 2 + 2? Reply with exactly "4".')
    .system('Return plain text only and follow the user instruction exactly.')
    .thinking(false)
    .temperature(0)
    .maxOutputTokens(50)
    .text();
  expect(text.trim().length).toBeGreaterThan(0);
}

describe('provider e2e', () => {
  itIf(hasOpenAI)('calls OpenAI with real credentials', { timeout: 60_000 }, async () => {
    await withQuotaSkip(async () => {
      const ai = genaicode(
        openai({
          apiKey: process.env.OPENAI_API_KEY,
          model: process.env.OPENAI_MODEL,
        }),
      );
      await runSmokeRequest(ai('What is 2 + 2? Reply with exactly "4".'));
    });
  });

  itIf(hasOpenAI)('OpenAI honors responseFormat json', { timeout: 60_000 }, async () => {
    await withQuotaSkip(async () => {
      const ai = genaicode(
        openai({
          apiKey: process.env.OPENAI_API_KEY,
          model: process.env.OPENAI_MODEL,
        }),
      );
      await runJsonResponseFormat(ai);
    });
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

  itIf(hasAnthropic)('Anthropic accepts thinking disabled', { timeout: 60_000 }, async () => {
    const ai = genaicode(
      anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
        model: process.env.ANTHROPIC_MODEL,
      }),
    );
    await runThinkingDisabled(ai);
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

  itIf(hasGemini)('Gemini honors responseFormat json', { timeout: 60_000 }, async () => {
    const ai = genaicode(
      gemini({
        apiKey: process.env.GEMINI_API_KEY,
        model: process.env.GEMINI_MODEL,
      }),
    );
    await runJsonResponseFormat(ai);
  });

  itIf(hasGemini)('Gemini accepts thinking disabled', { timeout: 60_000 }, async () => {
    const ai = genaicode(
      gemini({
        apiKey: process.env.GEMINI_API_KEY,
        model: process.env.GEMINI_MODEL,
      }),
    );
    await runThinkingDisabled(ai);
  });

  itIf(hasGemini)('Gemini accepts thinking level minimal', { timeout: 60_000 }, async () => {
    const ai = genaicode(
      gemini({
        apiKey: process.env.GEMINI_API_KEY,
        model: process.env.GEMINI_MODEL,
      }),
    );
    const text = await ai('What is 2 + 2? Reply with exactly "4".')
      .system('Return plain text only and follow the user instruction exactly.')
      .thinking({ level: 'minimal' })
      .temperature(0)
      .maxOutputTokens(50)
      .text();
    expect(text.trim().length).toBeGreaterThan(0);
  });
});
