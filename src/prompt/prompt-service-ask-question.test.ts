import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promptService } from './prompt-service.ts';
import * as vertexAi from '../ai-service/vertex-ai.ts';
import { FunctionCall } from '../ai-service/common.ts';
import * as readline from 'readline';
import '../cli/cli-params.ts';
import '../files/read-files.ts';
import '../files/find-files.ts';

vi.mock('../ai-service/vertex-ai.ts', () => ({ generateContent: vi.fn() }));
vi.mock('readline', () => ({
  createInterface: vi.fn(),
}));
vi.mock('../cli/cli-params.ts', () => ({
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
vi.mock('../files/find-files.ts', () => ({
  getSourceFiles: () => [],
  getImageAssetFiles: () => [],
}));

// Mock read-files module
vi.mock('../files/read-files.ts', () => ({
  getSourceCode: () => ({}),
  getImageAssets: vi.fn(() => ({})),
}));

vi.mock('../main/config.ts', () => ({
  rootDir: '/mocked/root/dir',
  rcConfig: {
    rootDir: '.',
    extensions: ['.js', '.ts', '.tsx', '.jsx'],
  },
}));

describe('promptService with askQuestion', () => {
  let mockReadline: { question: (_: unknown, callback: (msg: string) => void) => void; close: () => void };

  beforeEach(() => {
    vi.resetAllMocks();
    console.log = vi.fn();

    mockReadline = {
      question: vi.fn(),
      close: vi.fn(),
    };
    // @ts-expect-error (avoid complex mock)
    vi.spyOn(readline, 'createInterface').mockReturnValue(mockReadline);
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

    vi.mocked(mockReadline.question).mockImplementationOnce((_: unknown, callback: (msg: string) => void) => {
      callback('Yes');
    });

    await promptService(vertexAi.generateContent, undefined);

    expect(vertexAi.generateContent).toHaveBeenCalledTimes(3);
    expect(mockReadline.question).toHaveBeenCalledWith('Your answer: ', expect.any(Function));
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

    const result = await promptService(vertexAi.generateContent, undefined);

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

    await promptService(vertexAi.generateContent, undefined);

    expect(vertexAi.generateContent).toHaveBeenCalledTimes(2);
    expect(mockReadline.question).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith('Assistant did not ask a question. Proceeding with code generation.');
  });
});
