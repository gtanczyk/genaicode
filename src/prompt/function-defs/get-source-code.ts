import { FunctionDef } from '../../ai-service/common-types';

/**
 * Function definition for getSourceCode
 */
export const getSourceCode: FunctionDef = {
  name: 'getSourceCode',
  description: `This function returns source code of the application in the following format:
\`\`\`
{
  [filePath: string]: {
    content?: string | null,
    summary?: string,
    fileId?: string;
  }
}
\`\`\`

Some keys may not provide content. Some keys may provide a short summary of content.

Here is an example of the returned object:
\`\`\`
{
  '/path/to/directory/file1.js': {content: 'console.log('Hello, World!');', fileId: 'axb123'},
  '/path/to/directory/sub1/sub2/file2.js': {summary: 'This file contains a simple log statement.', fileId: 'cde456'},
}
\`\`\`

How to understand this object:
- there are 2 files
- the first file has content: 'console.log('Hello, World!');'
- the second file has no content, but a summary: 'This file contains a simple log statement.'
- path of first file: '/path/to/directory/file1.js'
- path of second file: '/path/to/directory/sub1/sub2/file2.js'
- both files have unique identifiers
    `,
  parameters: {
    type: 'object',
    properties: {
      filePaths: {
        type: 'array',
        description: 'An array of absolute paths of files that should be used to provided context.',
        items: {
          type: 'string',
        },
      },
    },
    required: [],
  },
};
