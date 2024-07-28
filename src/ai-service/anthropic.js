import Anthropic from '@anthropic-ai/sdk';
import { functionDefs } from './function-calling.js';
import { prepareMessages, printTokenUsageAndCost, processFunctionCalls } from './common.js';

/**
 * This function generates content using the Anthropic Claude model.
 *
 * @param systemPrompt System prompt for the chat model
 * @param prompt Prompt for the chat model
 * @returns Array of function calls
 */
export async function generateContent(systemPrompt, prompt) {
  const anthropic = new Anthropic({
    defaultHeaders: {
      'anthropic-beta': 'max-tokens-3-5-sonnet-2024-07-15',
    },
  });

  const messages = prepareMessages(prompt);

  const response = await anthropic.messages.create({
    model: 'claude-3-5-sonnet-20240620',
    system: systemPrompt,
    messages: mapCommonMessages(messages),
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

function mapCommonMessages(messages) {
  return [
    { role: 'user', content: messages.suggestSourceCode },
    {
      role: 'assistant',
      content: [
        { type: 'text', text: messages.requestSourceCode },
        {
          id: 'get_source_code',
          name: 'getSourceCode',
          input: {},
          type: 'tool_use',
        },
      ],
    },
    {
      role: 'user',
      content: [
        {
          tool_use_id: 'get_source_code',
          content: messages.sourceCode,
          type: 'tool_result',
        },
        { type: 'text', text: messages.prompt },
      ],
    },
  ];
}
