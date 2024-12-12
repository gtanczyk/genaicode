import { ActionHandlerProps, ActionResult, AskQuestionCall, SearchCodeArgs } from '../step-ask-question-types.js';
import { searchSourceCode } from '../../../../files/search-files.js';
import { FunctionCall, GenerateContentFunction, PromptItem } from '../../../../ai-service/common.js';
import { CodegenOptions } from '../../../../main/codegen-types.js';
import { getFunctionDefs } from '../../../function-calling.js';
import { putSystemMessage } from '../../../../main/common/content-bus.js';

/**
 * Handler for the searchCode action
 */
export async function handleSearchCode({
  askQuestionCall,
  generateContentFn,
  prompt,
  options,
}: ActionHandlerProps): Promise<ActionResult> {
  try {
    const searchCodeCall = await generateSearchCodeCall(generateContentFn, prompt, askQuestionCall, options, false);

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
            text: askQuestionCall.args?.message ?? '',
            functionCalls: [searchCodeCall],
          },
          user: {
            type: 'user',
            text: 'Search completed, lets continue the conversation.',
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

    return {
      breakLoop: false,
      items: [
        {
          assistant: {
            type: 'assistant',
            text: `Error performing search: ${errorMessage}\nPlease try again with valid search parameters.`,
          },
          user: {
            type: 'user',
            text: 'Let me try again with different search parameters.',
          },
        },
      ],
    };
  }
}

async function generateSearchCodeCall(
  generateContentFn: GenerateContentFunction,
  prompt: PromptItem[],
  askQuestionCall: AskQuestionCall,
  options: CodegenOptions,
  cheap: boolean,
) {
  const [searchCodeCall] = await generateContentFn(
    [
      ...prompt,
      {
        type: 'assistant',
        text: askQuestionCall.args?.message ?? '',
      },
      {
        type: 'user',
        text: 'Yes, you can search the code.',
      },
    ],
    getFunctionDefs(),
    'searchCode',
    0.7,
    cheap,
    options,
  );

  return searchCodeCall as FunctionCall<SearchCodeArgs> | undefined;
}
