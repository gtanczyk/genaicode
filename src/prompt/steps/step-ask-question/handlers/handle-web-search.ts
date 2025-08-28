import { FunctionCall, GenerateContentArgs, ModelType } from '../../../../ai-service/common-types.js';
import { putSystemMessage } from '../../../../main/common/content-bus.js';
import { getFunctionDefs } from '../../../function-calling.js';
import { WebSearchArgs } from '../../../function-defs/web-search.js';
import { registerActionHandler } from '../step-ask-question-handlers.js';
import { ActionHandler } from '../step-ask-question-types.js';

const handleWebSearch: ActionHandler = async ({ prompt, askQuestionCall, generateContentFn, options }) => {
  const request: GenerateContentArgs = [
    [
      ...prompt,
      {
        type: 'assistant',
        text: askQuestionCall.args!.message,
      },
      {
        type: 'user',
        text: 'Please provide an exhaustie search query',
      },
    ],
    {
      functionDefs: getFunctionDefs(),
      requiredFunctionName: 'webSearch',
      temperature: 0.7,
      modelType: ModelType.CHEAP,
      expectedResponseType: {
        text: false,
        functionCall: true,
        media: false,
      },
    },
    options,
  ];

  putSystemMessage('Inferring web search query...');

  const response = await generateContentFn(...request);
  const webSearchCall = (
    response
      .filter((item) => item.type === 'functionCall')
      .map((item) => item.functionCall) as FunctionCall<WebSearchArgs>[]
  ).find((call) => call.name === 'webSearch');

  if (!webSearchCall) {
    putSystemMessage('No web search call received, skipping web search.');
    prompt.push(
      {
        type: 'assistant',
        text: askQuestionCall.args!.message,
      },
      {
        type: 'user',
        text: 'Web search failed: No query provided',
      },
    );
    return {
      items: [],
      breakLoop: false,
    };
  }

  putSystemMessage('Performing web search for query', webSearchCall.args);

  const searchResponse = await generateContentFn(
    [
      {
        type: 'user',
        text: webSearchCall?.args?.query,
      },
    ],
    {
      temperature: 0.7,
      modelType: ModelType.CHEAP,
      expectedResponseType: {
        webSearch: true,
      },
    },
    options,
  );

  const webSearchResult = searchResponse.find((item) => item.type === 'webSearch');

  putSystemMessage('Web search completed, adding results to the conversation.', webSearchResult);

  prompt.push(
    {
      type: 'assistant',
      text: askQuestionCall.args!.message,
      functionCalls: [webSearchCall],
    },
    {
      type: 'user',
      functionResponses: [
        {
          name: 'webSearch',
          content: JSON.stringify(webSearchResult),
          call_id: webSearchCall?.id,
        },
      ],
    },
  );

  return {
    items: [],
    breakLoop: false,
  };
};

registerActionHandler('webSearch', handleWebSearch);
