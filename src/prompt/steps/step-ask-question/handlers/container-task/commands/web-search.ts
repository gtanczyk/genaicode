import { ModelType } from '../../../../../../ai-service/common-types.js';
import { putContainerLog } from '../../../../../../main/common/content-bus.js';
import { WebSearchArgs } from '../../../../../function-defs/web-search.js';
import { CommandHandlerBaseProps, CommandHandlerResult } from '../container-commands-types.js';

export async function handleWebSearch(props: CommandHandlerBaseProps): Promise<CommandHandlerResult> {
  const { actionResult, generateContentFn, options, taskExecutionPrompt } = props;
  const { query } = actionResult.args as WebSearchArgs;

  taskExecutionPrompt.push({
    type: 'assistant',
    functionCalls: [actionResult],
  });

  if (!query) {
    putContainerLog('warn', 'Web search command called without a query.');
    taskExecutionPrompt.push({
      type: 'user',
      functionResponses: [
        {
          name: actionResult.name,
          call_id: actionResult.id || undefined,
          content: 'Web search failed: Missing query',
        },
      ],
    });
    return {
      shouldBreakOuter: false,
      commandsExecutedIncrement: 1,
    };
  }

  putContainerLog('info', `Performing web search for: "${query}"`);

  try {
    const searchResponse = await generateContentFn(
      [
        {
          type: 'user',
          text: query,
        },
      ],
      {
        temperature: 0.7,
        modelType: ModelType.LITE,
        expectedResponseType: {
          webSearch: true,
        },
      },
      options,
    );

    const webSearchResult = searchResponse.find((item) => item.type === 'webSearch');

    if (webSearchResult) {
      putContainerLog('info', 'Web search completed successfully.', webSearchResult);
      taskExecutionPrompt.push({
        type: 'user',
        functionResponses: [
          {
            name: actionResult.name,
            call_id: actionResult.id || undefined,
            content: JSON.stringify(webSearchResult),
          },
        ],
      });
      return {
        shouldBreakOuter: false,
        commandsExecutedIncrement: 1,
      };
    } else {
      putContainerLog('warn', 'Web search did not return any results.');
      taskExecutionPrompt.push({
        type: 'user',
        functionResponses: [
          {
            name: actionResult.name,
            call_id: actionResult.id || undefined,
            content: 'Web search failed: No results found',
          },
        ],
      });
      return {
        shouldBreakOuter: false,
        commandsExecutedIncrement: 1,
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    putContainerLog('error', `Web search failed: ${errorMessage}`, { error });
    taskExecutionPrompt.push({
      type: 'user',
      functionResponses: [
        {
          name: actionResult.name,
          call_id: actionResult.id || undefined,
          content: `Web search failed: ${errorMessage}`,
        },
      ],
    });
    return {
      shouldBreakOuter: false,
      commandsExecutedIncrement: 1,
    };
  }
}
