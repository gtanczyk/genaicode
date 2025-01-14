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
import { AiServiceType, CodegenPlanningArgs, ImagenType } from '../main/codegen-types.js';
import { registerUserActionHandlers } from '../main/interactive/user-action-handlers.js';

vi.mock('../ai-service/vertex-ai.js', () => ({ generateContent: vi.fn() }));
vi.mock('@inquirer/prompts', () => ({
  input: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock('../cli/cli-params.js', () => ({
  disableExplanations: true,
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
          decisionMakingProcess: '',
          message: 'Do you want to proceed with code generation?',
          actionType: 'confirmCodeGeneration',
        },
      },
    ];
    const mockAskQuestionCall2 = [
      {
        name: 'askQuestion',
        args: {
          decisionMakingProcess: '',
          message: 'Ok lets go',
          actionType: 'confirmCodeGeneration',
        },
      },
    ];
    const mockCodegenPlanning: FunctionCall<CodegenPlanningArgs>[] = [
      {
        name: 'codegenPlanning',
        args: {
          problemAnalysis: '',
          codeChanges: '',
          affectedFiles: [],
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
      .mockResolvedValueOnce(mockCodegenPlanning)
      .mockResolvedValueOnce(mockCodegenSummary);

    vi.mocked(prompts.confirm).mockImplementationOnce(
      () => CancelablePromise.resolve(true) as CancelablePromise<boolean>,
    );

    await promptService(
      GENERATE_CONTENT_FNS,
      GENERATE_IMAGE_FNS,
      getCodeGenPrompt({
        aiService: 'vertex-ai',
        disableContextOptimization: true,
        explicitPrompt: 'test',
        interactive: true,
        askQuestion: true,
      }),
    );

    expect(vertexAi.generateContent).toHaveBeenCalledTimes(5);
    expect(prompts.confirm).toHaveBeenCalledWith({
      default: true,
      message: 'The assistant is ready to start code generation. Do you want to proceed?',
    });
    expect(console.log).toHaveBeenCalledWith('Do you want to proceed with code generation?', expect.any(Object));
    expect(console.log).toHaveBeenCalledWith('Proceeding with code generation.', undefined);
  });

  it('should stop code generation when askQuestion returns stopCodegen: true', async () => {
    const mockAskQuestionCall = [
      {
        name: 'askQuestion',
        args: {
          decisionMakingProcess: '',
          message: 'Stopping code generation as requested.',
          actionType: 'endConversation',
        },
      },
    ];

    vi.mocked(vertexAi.generateContent).mockResolvedValueOnce(mockAskQuestionCall);

    const result = await promptService(
      GENERATE_CONTENT_FNS,
      GENERATE_IMAGE_FNS,
      getCodeGenPrompt({
        aiService: 'vertex-ai',
        explicitPrompt: 'testx',
        disableContextOptimization: true,
        interactive: true,
        askQuestion: true,
      }),
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
      .mockResolvedValueOnce(mockAskQuestionCall) // First question
      .mockResolvedValueOnce(mockCodegenSummary);

    await promptService(
      GENERATE_CONTENT_FNS,
      GENERATE_IMAGE_FNS,
      getCodeGenPrompt({
        aiService: 'vertex-ai',
        explicitPrompt: 'testx',
        disableContextOptimization: true,
        interactive: true,
        askQuestion: true,
      }),
    );

    expect(vertexAi.generateContent).toHaveBeenCalledTimes(3);
    expect(prompts.input).not.toHaveBeenCalled();
  });
});
