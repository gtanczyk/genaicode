import { AnthropicVertex } from '@anthropic-ai/vertex-sdk';
import { printTokenUsageAndCost, processFunctionCalls } from './common.js';

/**
 * This function generates content using the Anthropic Claude model via Vertex AI.
 */
export async function generateContent(prompt, functionDefs, requiredFunctionName) {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT;
  const region = process.env.GOOGLE_CLOUD_REGION;

  if (!projectId || !region) {
    throw new Error('GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_REGION environment variables must be set');
  }

  const client = new AnthropicVertex({
    projectId,
    region,
  });

  const messages = prompt
    .filter((item) => item.type !== 'systemPrompt')
    .map((item) => {
      if (item.type === 'user') {
        return {
          role: 'user',
          content: [
            ...(item.functionResponses ?? []).map((response) => ({
              type: 'tool_result',
              tool_use_id: response.name,
              content: response.content,
            })),
            { type: 'text', text: item.text },
          ],
        };
      } else if (item.type === 'assistant') {
        return {
          role: 'assistant',
          content: [
            ...(item.text ? [{ type: 'text', text: item.text }] : []),
            ...item.functionCalls.map((call) => ({
              type: 'tool_use',
              id: call.name,
              name: call.name,
              input: call.args ?? {},
            })),
          ],
        };
      }
    });

  const response = await client.messages.create({
    model: 'claude-3-5-sonnet@20240620',
    max_tokens: 4096,
    system: prompt.find((item) => item.type === 'systemPrompt').systemPrompt,
    messages,
    tools: functionDefs.map((fd) => ({
      name: fd.name,
      description: fd.description,
      input_schema: fd.parameters,
    })),
    tool_choice: requiredFunctionName ? { type: 'tool', name: requiredFunctionName } : { type: 'any' },
  });

  // Print token usage for Anthropic Vertex AI
  const usage = {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    totalTokens: response.usage.input_tokens + response.usage.output_tokens,
  };
  printTokenUsageAndCost(usage, 3 / 1000 / 1000, 15 / 1000 / 1000);

  const responseMessages = response.content.filter((item) => item.type !== 'tool_use');
  if (responseMessages.length > 0) {
    console.log('Response messages', responseMessages);
  }

  const functionCalls = response.content
    .filter((item) => item.type === 'tool_use')
    .map((item) => ({
      name: item.name,
      args: item.input,
    }));

  return processFunctionCalls(functionCalls);
}
