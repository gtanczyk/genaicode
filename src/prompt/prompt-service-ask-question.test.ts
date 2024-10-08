import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promptService } from './prompt-service.js';
import * as vertexAi from '../ai-service/vertex-ai.js';
import { FunctionCall, GenerateContentFunction, GenerateImageFunction } from '../ai-service/common.js';
import * as prompts from '@inquirer/prompts';
import { CancelablePromise } from '@inquirer/type';
import '../cli/cli-params.js';
import '../files/cache-file.js';
import '../files/read-files.js';
import '../files/find-files.js';
import { getCodeGenPrompt } from './prompt-codegen.js';
import { AiServiceType, ImagenType } from '../main/codegen-types.js';
import { registerUserActionHandlers } from '../main/interactive/user-action-handlers.js';

vi.mock('../ai-service/vertex-ai.js', () => ({ generateContent: vi.fn() }));
vi.mock('@inquirer/prompts', () => ({
  input: vi.fn(),
}));
vi.mock('../cli/cli-params.js', () => ({
  disableExplanations: true,
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
vi.mock('../files/cache-file.js');
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

const GENERATE_CONTENT_FNS = { 'vertex-ai': vertexAi.generateContent } as Record<
  AiServiceType,
  GenerateContentFunction
>;
const GENERATE_IMAGE_FNS = {} as Record<ImagenType, GenerateImageFunction>;

describe('promptService with askQuestion', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    console.log = vi.fn();
    registerUserActionHandlers();
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
          actionType: 'requestAnswer',
          promptNecessity: 80,
        },
      },
    ];
    const mockAskQuestionCall2 = [
      {
        name: 'askQuestion',
        args: {
          content: 'Ok lets go',
          actionType: 'startCodeGeneration',
          promptNecessity: 80,
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
      GENERATE_CONTENT_FNS,
      GENERATE_IMAGE_FNS,
      getCodeGenPrompt({
        aiService: 'vertex-ai',
        disableContextOptimization: true,
        interactive: true,
        askQuestion: true,
      }),
    );

    expect(vertexAi.generateContent).toHaveBeenCalledTimes(3);
    expect(prompts.input).toHaveBeenCalledWith({ message: 'Your answer' });
    expect(console.log).toHaveBeenCalledWith('Assistant asks:', expect.any(Object));
    expect(console.log).toHaveBeenCalledWith('Proceeding with code generation.', undefined);
  });

  it('should stop code generation when askQuestion returns stopCodegen: true', async () => {
    const mockAskQuestionCall = [
      {
        name: 'askQuestion',
        args: {
          content: 'Stopping code generation as requested.',
          promptNecessity: 100,
          actionType: 'cancelCodeGeneration',
        },
      },
    ];

    vi.mocked(vertexAi.generateContent).mockResolvedValueOnce(mockAskQuestionCall);

    const result = await promptService(
      GENERATE_CONTENT_FNS,
      GENERATE_IMAGE_FNS,
      getCodeGenPrompt({ aiService: 'vertex-ai', disableContextOptimization: true, interactive: true }),
    );

    expect(vertexAi.generateContent).toHaveBeenCalledTimes(1);
    expect(result).toEqual([]);
    expect(console.log).toHaveBeenCalledWith('Assistant requested to stop code generation. Exiting...', undefined);
  });

  it('should not proceed with code generation when no askQuestion requests', async () => {
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
      .mockResolvedValueOnce(mockAskQuestionCall)
      .mockResolvedValueOnce(mockCodegenSummary);

    await promptService(
      GENERATE_CONTENT_FNS,
      GENERATE_IMAGE_FNS,
      getCodeGenPrompt({ aiService: 'vertex-ai', disableContextOptimization: true, interactive: true }),
    );

    expect(vertexAi.generateContent).toHaveBeenCalledTimes(2);
    expect(prompts.input).not.toHaveBeenCalled();
  });

  it('should handle self-reflection mechanism', async () => {
    const mockAskQuestionCall = [
      {
        name: 'askQuestion',
        args: {
          content: 'Do you want to proceed with code generation?',
          actionType: 'requestAnswer',
          promptNecessity: 80,
        },
      },
    ];
    const mockAskQuestionReflectCall = [
      {
        name: 'askQuestionReflect',
        args: {
          shouldEscalate: 70,
          reason: 'The response requires more advanced processing.',
        },
      },
    ];
    const mockAskQuestionReflectCall2 = [
      {
        name: 'askQuestionReflect',
        args: {
          shouldEscalate: 30,
          reason: 'The response is ok.',
        },
      },
    ];
    const mockAskQuestionCall2 = [
      {
        name: 'askQuestion',
        args: {
          content: 'Startin code generation',
          actionType: 'startCodeGeneration',
          promptNecessity: 80,
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
      .mockResolvedValueOnce(mockAskQuestionReflectCall)
      .mockResolvedValueOnce(mockAskQuestionCall)
      .mockResolvedValueOnce(mockAskQuestionCall2)
      .mockResolvedValueOnce(mockAskQuestionReflectCall2)
      .mockResolvedValueOnce(mockCodegenSummary);

    vi.mocked(prompts.input).mockImplementationOnce(
      () => CancelablePromise.resolve('Yes') as CancelablePromise<string>,
    );

    await promptService(
      GENERATE_CONTENT_FNS,
      GENERATE_IMAGE_FNS,
      getCodeGenPrompt({
        aiService: 'vertex-ai',
        disableContextOptimization: true,
        interactive: true,
        askQuestion: true,
        selfReflectionEnabled: true,
      }),
    );

    expect(vertexAi.generateContent).toHaveBeenCalledTimes(6);
    expect(console.log).toHaveBeenCalledWith(
      'Received codegen summary, will collect partial updates',
      expect.any(Object),
    );
  });
});
