import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promptService } from './prompt-service.js';
import * as vertexAi from '../ai-service/vertex-ai.js';
import * as readline from 'readline';
import '../cli/cli-params.js';
import '../files/read-files.js';
import '../files/find-files.js';

vi.mock('../ai-service/vertex-ai.js', () => ({ generateContent: vi.fn() }));
vi.mock('readline', () => ({
  createInterface: vi.fn(),
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
}));

describe('promptService with askQuestion', () => {
  let mockReadline;

  beforeEach(() => {
    vi.resetAllMocks();
    console.log = vi.fn();

    mockReadline = {
      question: vi.fn(),
      close: vi.fn(),
    };
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

    vertexAi.generateContent
      .mockResolvedValueOnce(mockAskQuestionCall)
      .mockResolvedValueOnce(mockAskQuestionCall2)
      .mockResolvedValueOnce(mockCodegenSummary);

    mockReadline.question.mockImplementationOnce((_, callback) => {
      callback('Yes');
    });

    await promptService(vertexAi.generateContent);

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

    vertexAi.generateContent.mockResolvedValueOnce(mockAskQuestionCall);

    const result = await promptService(vertexAi.generateContent);

    expect(vertexAi.generateContent).toHaveBeenCalledTimes(1);
    expect(result).toEqual([]);
    expect(console.log).toHaveBeenCalledWith('Assistant requested to stop code generation. Exiting...');
  });

  it('should proceed with code generation when askQuestion returns shouldPrompt: false', async () => {
    const mockAskQuestionCall = [];
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

    vertexAi.generateContent.mockResolvedValueOnce(mockAskQuestionCall).mockResolvedValueOnce(mockCodegenSummary);

    await promptService(vertexAi.generateContent);

    expect(vertexAi.generateContent).toHaveBeenCalledTimes(2);
    expect(mockReadline.question).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith('Assistant did not ask a question. Proceeding with code generation.');
  });
});
