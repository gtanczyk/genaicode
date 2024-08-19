import assert from 'node:assert';

const SYSTEM_PROMPT_LIMIT = 200;
const CODEGEN_PROMPT_LIMIT = 500;
const SOURCE_CODE_LIMIT = 20000;

function verifyPromptLimit(promptType: string, prompt: string, limit: number): void {
  const tokenCount = prompt.split(/\s+/).length;
  console.log(`${promptType} prompt token count: ${tokenCount}`);
  assert(tokenCount <= limit, `Token limit exceeded: ${tokenCount} > ${limit}`);
}

export function verifySystemPromptLimit(systemPrompt: string): void {
  verifyPromptLimit('system', systemPrompt, SYSTEM_PROMPT_LIMIT);
}

export function verifyCodegenPromptLimit(codeGenPrompt: string): void {
  verifyPromptLimit('codegen', codeGenPrompt, CODEGEN_PROMPT_LIMIT);
}

export function verifySourceCodeLimit(sourceCode: string): void {
  verifyPromptLimit('sourceCode', sourceCode, SOURCE_CODE_LIMIT);
}
