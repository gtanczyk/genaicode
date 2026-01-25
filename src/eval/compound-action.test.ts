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
} from '../prompt/steps/step-iterate/handlers/handle-compound-action.js';

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
      "Create a file /project/new.txt with 'hello' and update /project/existing.txt to 'new world content'";
    const initialPrompt: PromptItem[] = [...getBasePrompt(), { type: 'user', text: userMessage }];

    const compoundActionDef = getCompoundActionDef();
    const assistantPlanningMessage = 'Okay, I will plan the actions for you.';

    const planningPhasePrompt = constructCompoundActionPlanningPrompt(
      initialPrompt,
      assistantPlanningMessage,
      compoundActionDef,
    );

    const result = await generateContent(
      planningPhasePrompt,
      {
        modelType: ModelType.CHEAP,
        functionDefs: getFunctionDefs(),
        requiredFunctionName: compoundActionDef.name,
        temperature: 0.1,
        expectedResponseType: { text: false, functionCall: true, media: false },
      },
      baseCodegenOptions,
    );

    const functionCall = result.find((part) => part.type === 'functionCall')?.functionCall as
      | FunctionCall<{
          actions: Array<{ id: string; name: string; filePath?: string; dependsOn?: string[] }>;
          summary: string;
        }>
      | undefined;

    expect(functionCall).toBeDefined();
    expect(functionCall?.name).toBe(compoundActionDef.name);
    expect(functionCall?.args?.actions).toBeInstanceOf(Array);
    expect(functionCall?.args?.actions.length).toBeGreaterThanOrEqual(2);
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
              actions: [{ id: actionIdForTest, name: actionNameToTest, filePath: '/project/new_param_test.txt' }],
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
            }),
          },
        ],
      },
      {
        type: 'assistant',
        text: `I have inferred the actions and I am ready to determine their parameters.`,
      },
    ];

    const paramInferencePhasePrompt = constructCompoundActionParameterInferencePrompt(
      historyLeadingToParamInference,
      actionIdForTest,
      actionNameToTest,
      createFileOpDef!,
    );

    const result = await generateContent(
      paramInferencePhasePrompt,
      {
        modelType: ModelType.CHEAP,
        functionDefs: getFunctionDefs(),
        requiredFunctionName: actionNameToTest,
        temperature: 0.1,
        expectedResponseType: { text: false, functionCall: true, media: false },
      },
      baseCodegenOptions,
    );

    const functionCall = result.find((part) => part.type === 'functionCall')?.functionCall as
      | FunctionCall<{ filePath: string; newContent: string }>
      | undefined;

    expect(functionCall).toBeDefined();
    expect(functionCall?.name).toBe(actionNameToTest);
    expect(functionCall?.args?.filePath).toBeTypeOf('string');
    expect(functionCall?.args?.filePath).toContain('new_param_test.txt');
    expect(functionCall?.args?.newContent).toBeTypeOf('string');
    expect(functionCall?.args?.newContent.toLowerCase()).toContain('parameter inference content');
  });

  it('Test Case 3: Evaluates planning prompt for a 3-level DAG with an orphan action', async () => {
    const userMessage =
      'Please create the directory /project/dirA and the directory /project/dirB. ' +
      'Once /project/dirA exists, create the file /project/dirA/fileA1.txt. ' +
      'Once /project/dirB exists, create the file /project/dirB/fileB1.txt. ' +
      'After both /project/dirA/fileA1.txt and /project/dirB/fileB1.txt have been created, update the content of /project/fileC.txt. ' +
      'Separately from these tasks, please also delete the file /project/fileD.txt.';

    const initialPrompt: PromptItem[] = [...getBasePrompt(), { type: 'user', text: userMessage }];
    const compoundActionDef = getCompoundActionDef();
    const assistantPlanningMessage = 'Okay, I will plan this complex set of actions for you.';

    const planningPhasePrompt = constructCompoundActionPlanningPrompt(
      initialPrompt,
      assistantPlanningMessage,
      compoundActionDef,
    );

    const result = await generateContent(
      planningPhasePrompt,
      {
        modelType: ModelType.CHEAP,
        functionDefs: getFunctionDefs(),
        requiredFunctionName: compoundActionDef.name,
        temperature: 0.1,
        expectedResponseType: { text: false, functionCall: true, media: false },
      },
      baseCodegenOptions,
    );

    const functionCall = result.find((part) => part.type === 'functionCall')?.functionCall as
      | FunctionCall<{
          actions: Array<{ id: string; name: string; filePath?: string; dependsOn?: string[] }>;
          summary: string;
        }>
      | undefined;

    console.log(functionCall?.args);

    expect(functionCall).toBeDefined();
    expect(functionCall?.name).toBe(compoundActionDef.name);
    const actions = functionCall?.args?.actions;
    expect(actions).toBeInstanceOf(Array);
    expect(actions?.length).toBe(6); // 2 createDir, 2 createFile, 1 updateFile, 1 deleteFile

    const findAction = (name: string, idFragment: string) =>
      actions?.find((a) => a.name === name && a.id.toLowerCase().includes(idFragment.toLowerCase()));

    const dirA = findAction('createDirectory', 'dirA');
    const dirB = findAction('createDirectory', 'dirB');
    const fileA1 = findAction('createFile', 'a1');
    const fileB1 = findAction('createFile', 'b1');
    const fileC = findAction('updateFile', 'fileC');
    const fileD = findAction('deleteFile', 'fileD');

    expect(dirA).toBeDefined();
    expect(dirB).toBeDefined();
    expect(fileA1).toBeDefined();
    expect(fileB1).toBeDefined();
    expect(fileC).toBeDefined();
    expect(fileD).toBeDefined();

    // Check dependencies
    expect(fileA1?.dependsOn).toEqual(expect.arrayContaining([dirA?.id]));
    expect(fileB1?.dependsOn).toEqual(expect.arrayContaining([dirB?.id]));
    expect(fileC?.dependsOn).toEqual(expect.arrayContaining([fileA1?.id, fileB1?.id]));

    // Orphan action should have no dependencies listed, or an empty array
    expect(fileD?.dependsOn === undefined || fileD?.dependsOn?.length === 0).toBe(true);

    // Check for unique IDs
    const ids = actions?.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids?.length);

    expect(functionCall?.args?.summary).toBeTypeOf('string');
    expect(functionCall?.args?.summary.length).toBeGreaterThan(10);
  });

  it('Test Case 4: Evaluates planning prompt for a 3-level DAG based on implicit code dependencies', async () => {
    const userMessage =
      "I need to make some changes to how we handle user authentication. I've been looking at the `authenticateUser` function in `authService.ts`. " +
      'We also need to update the login flow component, `Login.tsx`, because it calls that service. ' +
      'And the integration tests for the login process, `login.test.ts`, will definitely need adjusting. ' +
      "While we're at it, let's add a simple README to the `components` directory.";

    const initialPrompt: PromptItem[] = [...getBasePrompt(), { type: 'user', text: userMessage }];
    const compoundActionDef = getCompoundActionDef();
    const assistantPlanningMessage = 'Okay, I will plan these code refactoring steps for you.';

    const planningPhasePrompt = constructCompoundActionPlanningPrompt(
      initialPrompt,
      assistantPlanningMessage,
      compoundActionDef,
    );

    const result = await generateContent(
      planningPhasePrompt,
      {
        modelType: ModelType.CHEAP,
        functionDefs: getFunctionDefs(),
        requiredFunctionName: compoundActionDef.name,
        temperature: 0.1,
        expectedResponseType: { text: false, functionCall: true, media: false },
      },
      baseCodegenOptions,
    );

    const functionCall = result.find((part) => part.type === 'functionCall')?.functionCall as
      | FunctionCall<{
          actions: Array<{
            id: string;
            name: string;
            filePath?: string;
            args?: Record<string, unknown>;
            dependsOn?: string[];
          }>;
          summary: string;
        }>
      | undefined;

    console.log(functionCall?.args);

    expect(functionCall).toBeDefined();
    expect(functionCall?.name).toBe(compoundActionDef.name);
    const actions = functionCall?.args?.actions;
    expect(actions).toBeInstanceOf(Array);
    expect(actions?.length).toBe(4); // 3 updateFile, 1 createFile

    const findAction = (name: string, ...keywords: string[]) =>
      actions?.find(
        (a) => a.name === name && keywords.every((keyword) => a.id.toLowerCase().includes(keyword.toLowerCase())),
      );

    const authServiceUpdate = findAction('updateFile', 'auth', 'update');
    const loginTsxUpdate = findAction('updateFile', 'login', 'update');
    const loginTestUpdate = findAction('updateFile', 'login', 'test');
    const readmeCreate = findAction('createFile', 'readme');

    expect(authServiceUpdate).toBeDefined();
    expect(loginTsxUpdate).toBeDefined();
    expect(loginTestUpdate).toBeDefined();
    expect(readmeCreate).toBeDefined();

    // Check filePaths
    expect(authServiceUpdate?.filePath).toContain('authService.ts');
    expect(loginTsxUpdate?.filePath).toContain('Login.tsx');
    expect(loginTestUpdate?.filePath).toContain('login.test.ts');
    expect(readmeCreate?.filePath).toContain('components/README');

    // Check for defined IDs needed for dependency checks
    expect(authServiceUpdate?.id).toBeDefined();
    expect(loginTsxUpdate?.id).toBeDefined();
    expect(loginTestUpdate?.id).toBeDefined();

    // Check dependencies
    expect(loginTsxUpdate?.dependsOn).toEqual(expect.arrayContaining([authServiceUpdate?.id]));
    expect(loginTestUpdate?.dependsOn).toEqual(expect.arrayContaining([loginTsxUpdate?.id]));

    // Orphan action
    expect(readmeCreate?.dependsOn === undefined || readmeCreate?.dependsOn?.length === 0).toBe(true);

    const ids = actions?.map((a) => a.id).filter((id) => id !== undefined) as string[];
    expect(new Set(ids).size).toBe(ids?.length);

    expect(functionCall?.args?.summary).toBeTypeOf('string');
    expect(functionCall?.args?.summary.length).toBeGreaterThan(10);
  });
});
