import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promptService } from './prompt-service.js';
import * as vertexAi from '../ai-service/vertex-ai.js';
import { FunctionCall } from '../ai-service/common.js';
import * as prompts from '@inquirer/prompts';
import { CancelablePromise } from '@inquirer/type';
import '../cli/cli-params.js';
import '../files/read-files.js';
import '../files/find-files.js';
import { getCodeGenPrompt } from './prompt-codegen.js';

vi.mock('../ai-service/vertex-ai.js', () => ({ generateContent: vi.fn() }));
vi.mock('@inquirer/prompts', () => ({
  input: vi.fn(),
}));
vi.mock('../cli/cli-params.js', () => ({
  requireExplanations: false,
  considerAllFiles: false,
  dependencyTree: false,
  explicitPrompt: false,
  allowFileCreate: false,
  allowFileDelete: false,
  allowDirectoryCreate: false,
  allowFileMove: false,
  verbosePrompt: false,
  disableContextOptimization: false,
  vision: false,
  imagen: false,
  temperature: 0.7,
  cheap: false,
  askQuestion: true,
}));

// Mock find-files module
vi.mock('../files/find-files.js', () => ({
  getSourceFiles: () => [],
  getImageAssetFiles: () => [],
}));

// Mock read-files module
vi.mock('../files/read-files.js', () => ({
  getSourceCode: () => ({}),
  getImageAssets: vi.fn(() => ({})),
}));

vi.mock('../main/config.js', () => ({
  rootDir: '/mocked/root/dir',
  rcConfig: {
    rootDir: '.',
    extensions: ['.js', '.ts', '.tsx', '.jsx'],
  },
  importantContext: {},
}));

describe('promptService with askQuestion', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    console.log = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should handle askQuestion when enabled', async () => {
    const mockAskQuestionCall = [
      {
        name: 'askQuestion',
        args: {
          content: 'Do you want to proceed with code generation?',
          shouldPrompt: true,
          promptNecessity: 80,
          stopCodegen: false,
        },
      },
    ];
    const mockAskQuestionCall2 = [
      {
        name: 'askQuestion',
        args: {
          content: 'Ok lets go',
          shouldPrompt: false,
          promptNecessity: 80,
          stopCodegen: false,
        },
      },
    ];
    const mockCodegenSummary = [
      {
        name: 'codegenSummary',
        args: {
          fileUpdates: [],
          contextPaths: [],
          explanation: 'No updates needed',
        },
      },
    ];

    vi.mocked(vertexAi.generateContent)
      .mockResolvedValueOnce(mockAskQuestionCall)
      .mockResolvedValueOnce(mockAskQuestionCall2)
      .mockResolvedValueOnce(mockCodegenSummary);

    vi.mocked(prompts.input).mockImplementationOnce(
      () => CancelablePromise.resolve('Yes') as CancelablePromise<string>,
    );

    await promptService(
      vertexAi.generateContent,
      undefined,
      getCodeGenPrompt({ aiService: 'vertex-ai', interactive: true }),
    );

    expect(vertexAi.generateContent).toHaveBeenCalledTimes(3);
    expect(prompts.input).toHaveBeenCalledWith({ message: 'Your answer' });
    expect(console.log).toHaveBeenCalledWith('Assistant asks:', expect.any(Object));
    expect(console.log).toHaveBeenCalledWith('The question was answered');
  });

  it('should stop code generation when askQuestion returns stopCodegen: true', async () => {
    const mockAskQuestionCall = [
      {
        name: 'askQuestion',
        args: {
          content: 'Stopping code generation as requested.',
          shouldPrompt: false,
          promptNecessity: 100,
          stopCodegen: true,
        },
      },
    ];

    vi.mocked(vertexAi.generateContent).mockResolvedValueOnce(mockAskQuestionCall);

    const result = await promptService(
      vertexAi.generateContent,
      undefined,
      getCodeGenPrompt({ aiService: 'vertex-ai', interactive: true }),
    );

    expect(vertexAi.generateContent).toHaveBeenCalledTimes(1);
    expect(result).toEqual([]);
    expect(console.log).toHaveBeenCalledWith('Assistant requested to stop code generation. Exiting...');
  });

  it('should proceed with code generation when askQuestion returns shouldPrompt: false', async () => {
    const mockAskQuestionCall: FunctionCall[] = [];
    const mockCodegenSummary = [
      {
        name: 'codegenSummary',
        args: {
          fileUpdates: [],
          contextPaths: [],
          explanation: 'No updates needed',
        },
      },
    ];

    vi.mocked(vertexAi.generateContent)
      .mockResolvedValueOnce(mockAskQuestionCall)
      .mockResolvedValueOnce(mockCodegenSummary);

    await promptService(
      vertexAi.generateContent,
      undefined,
      getCodeGenPrompt({ aiService: 'vertex-ai', interactive: true }),
    );

    expect(vertexAi.generateContent).toHaveBeenCalledTimes(2);
    expect(prompts.input).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith('Assistant did not ask a question. Proceeding with code generation.');
  });
});
