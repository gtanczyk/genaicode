import { ActionHandlerProps, ActionResult, IterateCall, SearchCodeArgs } from '../step-iterate-types.js';
import { searchSourceCode } from '../../../../files/search-files.js';
import { GenerateContentFunction } from '../../../../ai-service/common-types.js';
import { PromptItem } from '../../../../ai-service/common-types.js';
import { FunctionCall } from '../../../../ai-service/common-types.js';
import { ModelType } from '../../../../ai-service/common-types.js';
import { CodegenOptions } from '../../../../main/codegen-types.js';
import { getFunctionDefs } from '../../../function-calling.js';
import { putSystemMessage } from '../../../../main/common/content-bus.js';
import { registerActionHandler } from '../step-iterate-handlers.js';

registerActionHandler('searchCode', handleSearchCode);

export async function handleSearchCode({
  iterateCall,
  generateContentFn,
  prompt,
  options,
}: ActionHandlerProps): Promise<ActionResult> {
  try {
    const searchCodeCall = await generateSearchCodeCall(generateContentFn, prompt, iterateCall, options);

    // Extract search parameters from the call arguments
    const args = searchCodeCall?.args;
    if (!searchCodeCall || !args?.query) {
      throw new Error('Missing search query in searchCode call');
    }

    // Set default values for optional parameters
    const searchParams: SearchCodeArgs = {
      searchInContent: true,
      searchInFilenames: true,
      caseSensitive: false,
      maxResults: 50,
      contextLines: 2,
      ...args,
    };

    putSystemMessage('Searching code', searchParams);

    // Execute the search
    const searchResults = searchSourceCode(searchParams);

    putSystemMessage('Search completed', searchResults);

    // Return results in ActionResult format
    return {
      breakLoop: false,
      items: [
        {
          assistant: {
            type: 'assistant',
            text: iterateCall.args?.message ?? '',
            functionCalls: [searchCodeCall],
          },
          user: {
            type: 'user',
            functionResponses: [
              {
                name: 'searchCode',
                call_id: searchCodeCall.id,
                content: JSON.stringify(searchResults),
              },
            ],
          },
        },
      ],
    };
  } catch (error) {
    // Handle errors and return appropriate message
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred during search';

    putSystemMessage(`Error during searchCode: ${errorMessage}`);
    prompt.push({
      type: 'assistant',
      text: `Error performing search: ${errorMessage}\nPlease try again with valid search parameters.`,
    });
    prompt.push({
      type: 'user',
      text: 'Let me try again with different search parameters.',
    });

    return {
      breakLoop: false,
      items: [],
    };
  }
}

async function generateSearchCodeCall(
  generateContentFn: GenerateContentFunction,
  prompt: PromptItem[],
  iterateCall: IterateCall,
  options: CodegenOptions,
) {
  const [searchCodeCall] = (
    await generateContentFn(
      [
        ...prompt,
        {
          type: 'assistant',
          text: iterateCall.args?.message ?? '',
        },
        {
          type: 'user',
          text: 'Yes, you can search the code.',
        },
      ],
      {
        functionDefs: getFunctionDefs(),
        requiredFunctionName: 'searchCode',
        temperature: 0.7,
        modelType: ModelType.CHEAP,
        expectedResponseType: {
          text: false,
          functionCall: true,
          media: false,
        },
      },
      options,
    )
  )
    .filter((item) => item.type === 'functionCall')
    .map((item) => item.functionCall);

  return searchCodeCall as FunctionCall<SearchCodeArgs> | undefined;
}
