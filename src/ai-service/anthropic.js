import Anthropic from '@anthropic-ai/sdk';
import { printTokenUsageAndCost, processFunctionCalls } from './common.js';

/**
 * This function generates content using the Anthropic Claude model.
 */
export async function generateContent(prompt, functionDefs) {
  const anthropic = new Anthropic({
    defaultHeaders: {
      'anthropic-beta': 'max-tokens-3-5-sonnet-2024-07-15',
    },
  });

  const response = await anthropic.messages.create({
    model: 'claude-3-5-sonnet-20240620',
    system: prompt.find((item) => item.type === 'systemPrompt').systemPrompt,
    messages: prompt
      .filter((item) => item.type !== 'systemPrompt')
      .map((item) => {
        if (item.type === 'user') {
          return {
            role: 'user',
            content: [
              ...(item.functionResponse
                ? [
                    {
                      tool_use_id: item.functionResponse.name,
                      content: item.functionResponse.content,
                      type: 'tool_result',
                    },
                  ]
                : []),
              { type: 'text', text: item.text },
            ],
          };
        } else if (item.type === 'assistant') {
          return {
            role: 'assistant',
            content: [
              ...(item.text ? [{ type: 'text', text: item.text }] : []),
              {
                id: item.functionCall.name,
                name: item.functionCall.name,
                input: item.functionCall.args ?? {},
                type: 'tool_use',
              },
            ],
          };
        }
      }),
    tools: functionDefs.map((fd) => ({
      name: fd.name,
      description: fd.description,
      input_schema: fd.parameters,
    })),
    tool_choice: { type: 'any' },
    max_tokens: 8192,
  });

  // Print token usage for Anthropic
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
