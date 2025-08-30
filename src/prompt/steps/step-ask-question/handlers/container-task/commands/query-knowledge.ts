import { FunctionDef } from '../../../../../../ai-service/common-types.js';
import { CommandHandlerResult, CommandHandlerBaseProps } from '../container-commands-registry.js';
import { queryKnowledge } from '../../../../../../main/knowledge/knowledge-store.js';
import { QueryKnowledgeArgs } from '../../../../../../main/knowledge/types.js';
import { putContainerLog } from '../../../../../../main/common/content-bus.js';

export const queryKnowledgeDef: FunctionDef = {
  name: 'queryKnowledge',
  description:
    'Query the knowledge base with a natural language prompt to find relevant information from past tasks. Use this to check for existing solutions before attempting a complex step.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The natural language question to ask the knowledge base.',
      },
      explanation: {
        type: 'string',
        description: 'A brief explanation of what you are trying to find and why.',
      },
    },
    required: ['query', 'explanation'],
  },
};

export async function handleQueryKnowledge(props: CommandHandlerBaseProps): Promise<CommandHandlerResult> {
  const { generateContentFn, taskExecutionPrompt, actionResult } = props;
  const args = actionResult.args as QueryKnowledgeArgs;

  taskExecutionPrompt.push({
    type: 'assistant',
    functionCalls: [actionResult],
  });

  try {
    const results = await queryKnowledge(args, generateContentFn);
    const message = results.synthesizedResponse ? `Found relevant knowledge entries.` : `No relevant knowledge found.`;
    putContainerLog('info', message, { query: args.query, result: results.synthesizedResponse });

    taskExecutionPrompt.push({
      type: 'user',
      functionResponses: [
        {
          name: 'queryKnowledge',
          call_id: actionResult.id,
          content: JSON.stringify(results.synthesizedResponse, null, 2),
        },
      ],
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    putContainerLog('error', `Failed to query knowledge base: ${errorMessage}`, { error });
    taskExecutionPrompt.push({
      type: 'user',
      functionResponses: [
        {
          name: 'queryKnowledge',
          call_id: actionResult.id,
          content: `Failed to query knowledge base: ${errorMessage}`,
        },
      ],
    });
  }
}
