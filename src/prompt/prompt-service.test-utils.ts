import { FunctionCall } from '../ai-service/common-types';

/**
 * Common mock function call responses
 */
export const mockResponses = {
  // Mock response for codegenPlanning function
  mockPlanningResponse: (filePath: string): FunctionCall[] => [
    {
      name: 'codegenPlanning',
      args: {
        problemAnalysis: 'Test problem analysis',
        codeChanges: 'Test code changes plan',
        affectedFiles: [
          {
            filePath,
            reason: 'Test reason for modification',
            dependencies: [],
          },
        ],
      },
    },
  ],

  // Mock response for codegenSummary function
  mockCodegenSummary: (filePath: string, updateToolName: string = 'updateFile'): FunctionCall[] => [
    {
      name: 'codegenSummary',
      args: {
        fileUpdates: [
          {
            id: filePath,
            filePath,
            updateToolName,
            prompt: 'Generate file',
          },
        ],
        contextPaths: [],
        explanation: 'Mock summary',
      },
    },
  ],

  // Mock response for updateFile function
  mockUpdateFile: (filePath: string, content: string): FunctionCall[] => [
    {
      name: 'updateFile',
      args: {
        filePath,
        newContent: content,
      },
    },
  ],

  // Mock response for createFile function
  mockCreateFile: (filePath: string, content: string): FunctionCall[] => [
    {
      name: 'createFile',
      args: {
        filePath,
        newContent: content,
      },
    },
  ],

  // Mock response for deleteFile function
  mockDeleteFile: (filePath: string): FunctionCall[] => [
    {
      name: 'deleteFile',
      args: {
        filePath,
      },
    },
  ],

  // Mock response for patchFile function
  mockPatchFile: (filePath: string, patch: string, injectArgs?: object): FunctionCall[] => [
    {
      name: 'patchFile',
      args: {
        filePath,
        patch,
        ...injectArgs,
      },
    },
  ],

  // Mock response for generateImage function
  mockGenerateImage: (filePath: string, width = 256, height = 256): FunctionCall[] => [
    {
      name: 'generateImage',
      args: {
        prompt: 'A test image',
        filePath,
        width,
        height,
      },
    },
  ],

  // Mock response for downloadFile function (used after image generation)
  mockDownloadFile: (filePath: string, downloadUrl: string): FunctionCall[] => [
    {
      name: 'downloadFile',
      args: {
        filePath,
        explanation: 'Downloading generated image',
        downloadUrl,
      },
    },
  ],

  // Mock response for explanation function
  mockExplanation: (text: string): FunctionCall[] => [
    {
      name: 'explanation',
      args: {
        text,
      },
    },
  ],
};

/**
 * Common mock data structures
 */
export const mockData = {
  // Mock image assets
  imageAssets: {
    '/path/to/image1.png': { width: 100, height: 100, mimeType: 'image/png' },
    '/path/to/image2.jpg': { width: 200, height: 200, mimeType: 'image/jpeg' },
  },

  // Mock file content
  fileContent: 'Original content',

  // Mock base paths
  paths: {
    root: '/mocked/root/dir',
    get test() {
      return `${this.root}/test.js`;
    },
    get image() {
      return `${this.root}/image.png`;
    },
    get context1() {
      return `${this.root}/context1.js`;
    },
    get context2() {
      return `${this.root}/context2.js`;
    },
  },

  // Mock image generation URL
  imageGenerationUrl: 'https://example.com/generated-image.png',
};

/**
 * Common test configurations
 */
export const testConfigs = {
  // Base configuration for tests
  baseConfig: {
    askQuestion: false,
    disableContextOptimization: true,
    explicitPrompt: 'testx',
    aiService: 'vertex-ai' as const,
  },

  // Configuration with vision enabled
  visionConfig: {
    askQuestion: false,
    disableContextOptimization: true,
    explicitPrompt: 'testx',
    aiService: 'openai' as const,
    vision: true,
  },

  // Configuration with imagen enabled
  imagenConfig: {
    askQuestion: false,
    disableContextOptimization: true,
    explicitPrompt: 'testx',
    aiService: 'vertex-ai' as const,
    imagen: 'dall-e' as const,
  },
};
