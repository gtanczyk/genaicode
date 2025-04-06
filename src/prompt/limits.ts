import assert from 'node:assert';
import { estimateTokenCount } from './token-estimator.js';

const SYSTEM_PROMPT_LIMIT = 3500;
const CODEGEN_PROMPT_LIMIT = 1600;
const SOURCE_CODE_LIMIT = 160000;

function verifyPromptLimit(promptType: string, prompt: string, limit: number): number {
  const tokenCount = estimateTokenCount(prompt);
  console.log(`${promptType} prompt estimated token count: ${tokenCount}`);
  assert(tokenCount <= limit, `Token limit exceeded: ${tokenCount} > ${limit}`);
  return tokenCount;
}

export function verifySystemPromptLimit(systemPrompt: string): number {
  return verifyPromptLimit('system', systemPrompt, SYSTEM_PROMPT_LIMIT);
}

export function verifyCodegenPromptLimit(codeGenPrompt: string): number {
  return verifyPromptLimit('codegen', codeGenPrompt, CODEGEN_PROMPT_LIMIT);
}

export function verifySourceCodeLimit(sourceCode: string): number {
  return verifyPromptLimit('sourceCode', sourceCode, SOURCE_CODE_LIMIT);
}
