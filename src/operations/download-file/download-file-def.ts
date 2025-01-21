import { FunctionDef } from '../../ai-service/common-types';

/**
 * Function definition for downloadFile
 */
export const downloadFileDef: FunctionDef = {
  name: 'downloadFile',
  description: 'Download file from url, and save to file',
  parameters: {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: 'The file path to save the downloaded file.',
      },
      downloadUrl: {
        type: 'string',
        description: 'The url of the file that will be used for downloading.',
      },
      explanation: {
        type: 'string',
        description: 'The reasoning behind downloading this image.',
      },
    },
    required: ['filePath', 'downloadUrl'],
  },
};

export type DownloadFileArgs = {
  filePath: string;
  downloadUrl: string;
  explanation?: string;
};
