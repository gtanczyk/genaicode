import { FunctionDef, ModelType, FunctionCall, PromptItem } from '../../../../../../ai-service/common-types.js';
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

  try {
    const results = await queryKnowledge(args, generateContentFn);
    const message =
      results.synthesizedResponse && results.sourceEntries?.length
        ? `Found relevant knowledge entries.`
        : `No relevant knowledge found.`;
    putContainerLog('info', message, { query: args.query, results: results });

    taskExecutionPrompt.push(
      {
        type: 'assistant',
        functionCalls: [actionResult],
      },
      {
        type: 'user',
        functionResponses: [
          {
            name: 'queryKnowledge',
            call_id: actionResult.id,
            content: JSON.stringify(results),
          },
        ],
      },
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    putContainerLog('error', `Failed to query knowledge base: ${errorMessage}`, { error });
    taskExecutionPrompt.push(
      {
        type: 'assistant',
        functionCalls: [actionResult],
      },
      {
        type: 'user',
        functionResponses: [
          {
            name: 'queryKnowledge',
            call_id: actionResult.id,
            content: `Failed to query knowledge base: ${errorMessage}`,
          },
        ],
      },
    );
  }
}

export async function maybeQueryKnowledge(
  props: CommandHandlerBaseProps & { systemPrompt: PromptItem; taskPrompt: PromptItem },
): Promise<CommandHandlerResult> {
  const { generateContentFn, taskExecutionPrompt } = props;
  try {
    const response = await generateContentFn(
      [props.systemPrompt, props.taskPrompt, ...taskExecutionPrompt],
      {
        modelType: ModelType.LITE,
        temperature: 0.2,
        functionDefs: [queryKnowledgeDef],
        requiredFunctionName: 'queryKnowledge',
        expectedResponseType: { functionCall: true, text: false, media: false },
      },
      { disableCache: true },
    );

    const functionCall = response.find((part) => part.type === 'functionCall')?.functionCall as
      | FunctionCall<QueryKnowledgeArgs>
      | undefined;

    if (functionCall?.name !== 'queryKnowledge') {
      putContainerLog('warn', 'maybeQueryKnowledge: LLM did not produce a valid queryKnowledge function call.');
      return;
    }

    return await handleQueryKnowledge({ ...props, actionResult: functionCall });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    putContainerLog('error', 'Error during maybeQueryKnowledge execution', { error: errorMessage });
  }
}
