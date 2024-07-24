import assert from 'node:assert';

const SYSTEM_PROMPT_LIMIT = 10000;
const CODEGEN_PROMPT_LIMIT = 1000;

function verifyPromptLimit(promptType, prompt, limit) {
  const tokenCount = prompt.split(/\s+/).length;
  console.log(`${promptType} prompt token count: ${tokenCount}`);
  assert(tokenCount <= limit, `Token limit exceeded: ${tokenCount} > ${limit}`);
}

export function verifySystemPromptLimit(systemPrompt) {
  verifyPromptLimit('system', systemPrompt, SYSTEM_PROMPT_LIMIT);
}

export function verifyCodegenPromptLimit(codeGenPrompt) {
  verifyPromptLimit('codegen', codeGenPrompt, CODEGEN_PROMPT_LIMIT);
}
