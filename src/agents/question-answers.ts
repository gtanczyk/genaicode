import type { QuestionAnswers } from './types.js';

/**
 * Answers as a browser sent them (`{ [questionId]: string[] }`), or undefined when they are not
 * that shape or too large. Which questions they answer is checked by the session.
 */
export function parseQuestionAnswers(value: unknown): QuestionAnswers | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 8) return undefined;
  const answers: QuestionAnswers = {};
  for (const [key, given] of entries) {
    if (key.length > 500 || !Array.isArray(given) || given.length > 21) return undefined;
    if (!given.every((item) => typeof item === 'string' && item.length <= 10_000)) return undefined;
    answers[key] = given as string[];
  }
  return answers;
}
