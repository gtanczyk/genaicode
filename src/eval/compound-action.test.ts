import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateContent as generateContentAiStudio } from '../ai-service/ai-studio.js';
import { generateContent as generateContentAnthropic } from '../ai-service/anthropic.js';
import { generateContent as generateContentOpenAI } from '../ai-service/openai.js';
import {
  PromptItem,
  GenerateContentFunction,
  FunctionDef,
  ModelType,
  FunctionCall,
} from '../ai-service/common-types.js';
import { getSystemPrompt } from '../prompt/systemprompt.js';
import {
  INITIAL_GREETING,
  READY_TO_ASSIST,
  REQUEST_SOURCE_CODE,
  SOURCE_CODE_RESPONSE,
} from '../prompt/static-prompts.js';
import { retryGenerateContent } from './test-utils/generate-content-retry.js';
import { getCompoundActionDef } from '../prompt/function-defs/compound-action.js';
import { getOperationDefs } from '../operations/operations-index.js';
import { getFunctionDefs } from '../prompt/function-calling.js';
import { AiServiceType, CodegenOptions } from '../main/codegen-types.js';
import { MOCK_SOURCE_CODE_CONTENTS_LARGE } from './data/mock-source-code-contents-large.js';
import {
  constructCompoundActionPlanningPrompt,
  constructCompoundActionParameterInferencePrompt,
} from '../prompt/steps/step-ask-question/handlers/handle-compound-action.js';

vi.setConfig({ testTimeout: 5 * 60000 }); // Increased timeout for live AI calls

const getOperationDef = (name: string): FunctionDef | undefined => {
  return getOperationDefs().find((op) => op.name === name);
};

describe.each([
  { modelName: 'Gemini Flash', generateContentFn: generateContentAiStudio, serviceName: 'ai-studio' as AiServiceType },
  { modelName: 'Claude Haiku', generateContentFn: generateContentAnthropic, serviceName: 'anthropic' as AiServiceType },
  { modelName: 'GPT-4o Mini', generateContentFn: generateContentOpenAI, serviceName: 'openai' as AiServiceType },
])('Compound Action Prompt Evaluation: $modelName', ({ generateContentFn, serviceName }) => {
  let generateContent: GenerateContentFunction;

  beforeEach(() => {
    vi.resetAllMocks();
    generateContent = retryGenerateContent(generateContentFn);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const rootDir = '/project';
  const baseCodegenOptions: CodegenOptions = {
    verbose: false,
    askQuestion: true,
    interactive: true,
    ui: false,
    allowFileCreate: true,
    allowFileDelete: true,
    allowDirectoryCreate: true,
    allowFileMove: true,
    vision: false,
    historyEnabled: false,
    aiService: serviceName,
  };

  const getBasePrompt = (): PromptItem[] => [
    {
      type: 'systemPrompt',
      systemPrompt: getSystemPrompt({ rootDir }, baseCodegenOptions),
    },
    { type: 'user', text: INITIAL_GREETING },
    {
      type: 'assistant',
      text: REQUEST_SOURCE_CODE,
      functionCalls: [{ name: 'getSourceCode' }],
    },
    {
      type: 'user',
      text: SOURCE_CODE_RESPONSE,
      functionResponses: [
        {
          name: 'getSourceCode',
          content: JSON.stringify(MOCK_SOURCE_CODE_CONTENTS_LARGE),
        },
      ],
    },
    {
      type: 'assistant',
      text: READY_TO_ASSIST,
    },
  ];

  it('Test Case 1: Evaluates the planning prompt for a simple compound action', async () => {
    const userMessage =
      "Create a file /project/new.txt with 'hello' and update /project/src/main/project-manager.ts to 'new world content'";
    const initialPrompt: PromptItem[] = [...getBasePrompt(), { type: 'user', text: userMessage }];

    const compoundActionDef = getCompoundActionDef();
    const assistantPlanningMessage = 'Okay, I will plan the actions for you.';

    // Use the exported function to construct the planning prompt
    const planningPhasePrompt = constructCompoundActionPlanningPrompt(
      initialPrompt,
      assistantPlanningMessage,
      compoundActionDef,
    );

    const result = await generateContent(
      planningPhasePrompt,
      {
        modelType: ModelType.DEFAULT,
        functionDefs: getFunctionDefs(), // getFunctionDefs includes compoundActionDef and others
        requiredFunctionName: compoundActionDef.name,
        temperature: 0.1,
        expectedResponseType: { text: false, functionCall: true, media: false },
      },
      baseCodegenOptions,
    );

    const functionCall = result.find((part) => part.type === 'functionCall')?.functionCall as
      | FunctionCall<{
          actions: Array<{ id: string; name: string; dependsOn?: string[] }>;
          summary: string;
        }>
      | undefined;

    console.log(functionCall?.args);

    expect(functionCall).toBeDefined();
    expect(functionCall?.name).toBe(compoundActionDef.name);
    expect(functionCall?.args?.actions).toBeInstanceOf(Array);
    expect(functionCall?.args?.actions.length).toBeGreaterThanOrEqual(2);
    // Check for specific actions if the model is consistent enough, otherwise check for general structure
    const actionNames = functionCall?.args?.actions.map((a) => a.name) ?? [];
    expect(actionNames).toContain('createFile');
    expect(actionNames).toContain('updateFile');
    expect(functionCall?.args?.summary).toBeTypeOf('string');
    expect(functionCall?.args?.summary.length).toBeGreaterThan(10);
  });

  it('Test Case 2: Evaluates parameter inference prompt for createFile', async () => {
    const userMessage = "Create a file /project/new_param_test.txt with 'parameter inference content'";
    const createFileOpDef = getOperationDef('createFile');
    expect(createFileOpDef).toBeDefined();

    // Simulate conversation history leading up to parameter inference for createFile
    // This history must be compatible with how constructCompoundActionParameterInferencePrompt expects it.
    const actionIdForTest = 'action1';
    const actionNameToTest = 'createFile';

    const historyLeadingToParamInference: PromptItem[] = [
      ...getBasePrompt(),
      { type: 'user', text: userMessage },
      {
        type: 'assistant',
        text: 'Okay, I will plan the actions.',
        functionCalls: [
          {
            name: getCompoundActionDef().name,
            args: {
              actions: [{ id: actionIdForTest, name: actionNameToTest }],
              summary: `Will create /project/new_param_test.txt.`,
            },
          },
        ],
      },
      {
        type: 'user',
        functionResponses: [
          {
            name: getCompoundActionDef().name,
            content: JSON.stringify({
              filePath: '/project/new_param_test.txt',
              newContent: 'parameter inference content',
            }),
          },
        ],
      },
      {
        type: 'assistant',
        text: `I have inferred the actions and I am ready to determine their parameters.`,
      },
    ];

    // Use the exported function to construct the parameter inference prompt
    const paramInferencePhasePrompt = constructCompoundActionParameterInferencePrompt(
      historyLeadingToParamInference,
      actionIdForTest,
      actionNameToTest,
      createFileOpDef!,
    );

    const result = await generateContent(
      paramInferencePhasePrompt,
      {
        modelType: ModelType.DEFAULT,
        functionDefs: getFunctionDefs(), // getFunctionDefs includes createFileOpDef and others
        requiredFunctionName: actionNameToTest,
        temperature: 0.1,
        expectedResponseType: { text: false, functionCall: true, media: false },
      },
      baseCodegenOptions,
    );

    const functionCall = result.find((part) => part.type === 'functionCall')?.functionCall as
      | FunctionCall<{ filePath: string; newContent: string }>
      | undefined;

    console.log(functionCall?.args);

    expect(functionCall).toBeDefined();
    expect(functionCall?.name).toBe(actionNameToTest);
    expect(functionCall?.args?.filePath).toBeTypeOf('string');
    // Looser check for content as AI might slightly rephrase
    expect(functionCall?.args?.filePath).toContain('new_param_test.txt');
    expect(functionCall?.args?.newContent).toBeTypeOf('string');
    expect(functionCall?.args?.newContent.toLowerCase()).toContain('parameter inference content');
  });
});
