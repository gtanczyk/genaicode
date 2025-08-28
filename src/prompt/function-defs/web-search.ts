import { FunctionDef } from '../../ai-service/common-types';

export const webSearchDef: FunctionDef = {
  name: 'webSearch',
  description: `Performs a web search and returns a grounded answer with source URLs.
The answer is not displayed to the user. It should be used to inform following actions.`,
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'An exhaustive prompt or question for the web search.',
      },
    },
    required: ['query'],
  },
};

export type WebSearchArgs = {
  query: string;
};

export type WebSearchResult = {
  summary: string;
  urls: string[];
};
