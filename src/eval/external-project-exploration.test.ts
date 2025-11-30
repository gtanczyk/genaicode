import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateContent as generateContentAiStudio } from '../ai-service/ai-studio.js';
import { generateContent as generateContentAnthropic } from '../ai-service/anthropic.js';
import { generateContent as generateContentOpenAI } from '../ai-service/openai.js';
import {
  PromptItem,
  ModelType,
  GenerateContentFunction,
  FunctionCall,
  GenerateContentResult,
} from '../ai-service/common-types.js';
import { getSystemPrompt } from '../prompt/systemprompt.js';
import { getFunctionDefs } from '../prompt/function-calling.js';
import { exploreExternalDirectories as exploreExternalDirectoriesDef } from '../prompt/function-defs/explore-external-directories.js';
import { readExternalFiles as readExternalFilesDef } from '../prompt/function-defs/read-external-files.js';
import { retryGenerateContent } from './test-utils/generate-content-retry.js';
import { validateAndRecoverSingleResult } from '../prompt/steps/step-validate-recover.js';
import { RcConfig } from '../main/config-types.js';
import { CodegenOptions } from '../main/codegen-types.js';
import {
  ConversationNodeId,
  ConversationGraphArgs,
  EvaluateEdgeArgs,
} from '../prompt/function-defs/conversation-graph.js';
import {
  CONVERSATION_GRAPH_PROMPT, // Import the prompt guide
  getEdgeEvaluationPrompt,
} from '../prompt/steps/step-ask-question/handlers/handle-conversation-graph.js';
import { AskQuestionCall } from '../prompt/steps/step-ask-question/step-ask-question-types.js';

vi.setConfig({
  // Increased timeout for real AI calls
  testTimeout: 5 * 60000,
});

// Mock rcConfig for consistent paths
const mockRcConfig: Partial<RcConfig> = {
  rootDir: '/project/src/genaicode',
};

// Base Codegen Options enabling askQuestion/interactive
const baseOptions: Omit<CodegenOptions, 'aiService'> = {
  explicitPrompt: undefined,
  taskFile: undefined,
  allowFileCreate: true,
  allowFileDelete: true,
  allowDirectoryCreate: true,
  allowFileMove: true,
  vision: false,
  imagen: undefined,
  disableContextOptimization: false,
  temperature: 0.2,
  cheap: false,
  dryRun: false,
  verbose: false,
  requireExplanations: true,
  geminiBlockNone: false,
  contentMask: undefined,
  ignorePatterns: [],
  askQuestion: true,
  disableCache: false,
  interactive: true,
  ui: false,
  uiPort: 1337,
  disableAiServiceFallback: false,
  historyEnabled: false,
  conversationSummaryEnabled: false,
  isDev: false,
};

describe.each([
  {
    model: 'Gemini Flash',
    generateContent: generateContentAiStudio,
    modelType: ModelType.CHEAP,
    service: 'ai-studio' as const,
  },
  {
    model: 'Claude Haiku',
    generateContent: generateContentAnthropic,
    modelType: ModelType.CHEAP,
    service: 'anthropic' as const,
  },
  {
    model: 'GPT-4o Mini',
    generateContent: generateContentOpenAI,
    modelType: ModelType.CHEAP,
    service: 'openai' as const,
  },
])(
  'External Project Exploration Strategy: $model',
  ({ generateContent: originalGenerateContent, modelType, service }) => {
    let generateContent: GenerateContentFunction;
    let currentOptions: CodegenOptions;

    beforeEach(() => {
      vi.clearAllMocks(); // Ensure mocks are clean for each test
      generateContent = retryGenerateContent(originalGenerateContent);
      currentOptions = { ...baseOptions, aiService: service }; // Set aiService for the current test case
    });

    it('should decide to explore external directory when requested', async () => {
      const userPromptText = 'Analyze the config files in /external/project-a';
      const externalDir = '/external/project-a';

      // --- Test Execution ---  Focus on the first LLM decision
      const currentPrompt: PromptItem[] = [
        { type: 'systemPrompt', systemPrompt: getSystemPrompt(mockRcConfig as RcConfig, currentOptions) },
        { type: 'user', text: userPromptText },
      ];

      const generateContentArgs: Parameters<GenerateContentFunction> = [
        currentPrompt,
        {
          functionDefs: getFunctionDefs(),
          requiredFunctionName: 'askQuestion', // Expecting askQuestion to trigger the action
          modelType,
          temperature: 0.2,
        },
        currentOptions,
      ];

      // Make the actual LLM call to get the askQuestion decision
      const result = await generateContent(...generateContentArgs);
      const askQuestionCalls = (await validateAndRecoverSingleResult(generateContentArgs, result, generateContent))
        .filter((item) => item.type === 'functionCall')
        .map((item) => item.functionCall);

      expect(askQuestionCalls.length).toBe(1);
      const askExploreCall = askQuestionCalls[0];

      expect(askExploreCall).toBeDefined();
      expect(askExploreCall?.args?.actionType).toBe('exploreExternalDirectories');
      expect(askExploreCall?.args?.message).toMatch(/explore|look into|check/i); // Expect message about exploring
      expect(askExploreCall?.args?.message).toContain(externalDir);

      console.log(`Test 1 (${modelType} - ${service}): Passed - Correctly decided to explore.`);
    });

    it('should decide to read files after successful exploration (filePaths)', async () => {
      const userPromptText = 'Analyze the config files in /external/project-a';
      const externalDir = '/external/project-a';
      const foundFiles = [`${externalDir}/config.json`, `${externalDir}/settings.yaml`];

      // Mock the tool execution result for exploration
      const exploreToolResponse: PromptItem = {
        type: 'user', // Simulating tool response
        functionResponses: [
          {
            name: exploreExternalDirectoriesDef.name,
            call_id: 'mock_explore_call_id', // Must match the ID used in the preceding assistant call
            content: JSON.stringify({
              requestedDirectories: [externalDir],
              reason: 'Find config files for analysis',
              fileCount: foundFiles.length,
              filePaths: foundFiles,
              synthesis: undefined, // No synthesis needed
            }),
          },
        ],
        text: 'Exploration complete.',
      };

      // --- Test Execution --- Focus on the LLM decision *after* getting explore results
      const currentPrompt: PromptItem[] = [
        { type: 'systemPrompt', systemPrompt: getSystemPrompt(mockRcConfig as RcConfig, currentOptions) },
        { type: 'user', text: userPromptText }, // Original user request
        {
          type: 'assistant',
          text: `Okay, I need to explore ${externalDir} to find the config files. Proceed?`,
          functionCalls: [
            {
              id: 'mock_explore_call_id', // ID for the explore call
              name: 'askQuestion',
              args: { actionType: 'exploreExternalDirectories', message: '...' },
            },
          ],
        },
        exploreToolResponse, // Add the result of the exploration here
      ];

      const generateContentArgs: Parameters<GenerateContentFunction> = [
        currentPrompt,
        {
          functionDefs: getFunctionDefs(),
          requiredFunctionName: 'askQuestion', // Expecting askQuestion to trigger the next action
          modelType,
          temperature: 0.2,
        },
        currentOptions,
      ];

      // Make the actual LLM call to get the next askQuestion decision
      const result = await generateContent(...generateContentArgs);
      const askQuestionCalls = (await validateAndRecoverSingleResult(generateContentArgs, result, generateContent))
        .filter((item) => item.type === 'functionCall')
        .map((item) => item.functionCall);

      expect(askQuestionCalls.length).toBe(1);
      const askReadCall = askQuestionCalls[0];

      expect(askReadCall).toBeDefined();
      expect(askReadCall?.args?.actionType).toBe('readExternalFiles');
      expect(askReadCall?.args?.message).toMatch(/read|analyze|examine/i); // Expect message about reading
      // Check if the message mentions the specific files found
      expect(askReadCall?.args?.message).toContain('config.json');
      expect(askReadCall?.args?.message).toContain('settings.yaml');

      console.log(`Test 2 (${modelType} - ${service}): Passed - Correctly decided to read discovered files.`);
    });

    it('should decide to explore deeper after receiving synthesis', async () => {
      const userPromptText = 'Analyze the source code in the large external project /external/project-b';
      const externalDir = '/external/project-b';
      const deeperDir = `${externalDir}/src`;

      // Mock the tool execution result for exploration (Synthesis)
      const exploreToolResponseSynthesis: PromptItem = {
        type: 'user', // Simulating tool response
        functionResponses: [
          {
            name: exploreExternalDirectoriesDef.name,
            call_id: 'mock_explore_call_id_2',
            content: JSON.stringify({
              requestedDirectories: [externalDir],
              reason: 'Analyze source code',
              fileCount: 500, // Simulate exceeding threshold
              filePaths: [],
              synthesis: 'Found 500 files. Main source seems to be in the `src` subdirectory.',
            }),
          },
        ],
        text: 'Initial exploration complete (synthesis provided).',
      };

      // --- Test Execution --- Focus on LLM decision after getting synthesis
      const currentPrompt: PromptItem[] = [
        { type: 'systemPrompt', systemPrompt: getSystemPrompt(mockRcConfig as RcConfig, currentOptions) },
        { type: 'user', text: userPromptText },
        {
          type: 'assistant',
          text: `Okay, I need to explore ${externalDir} first. Proceed?`,
          functionCalls: [
            {
              id: 'mock_explore_call_id_2', // ID for the initial explore call
              name: 'askQuestion',
              args: { actionType: 'exploreExternalDirectories', message: '...' },
            },
          ],
        },
        exploreToolResponseSynthesis, // Add the synthesis result
      ];

      const generateContentArgs: Parameters<GenerateContentFunction> = [
        currentPrompt,
        {
          functionDefs: getFunctionDefs(),
          requiredFunctionName: 'askQuestion', // Expecting askQuestion to trigger the next action
          modelType,
          temperature: 0.2,
        },
        currentOptions,
      ];

      // Make the actual LLM call
      const result = await generateContent(...generateContentArgs);
      const askQuestionCalls = (await validateAndRecoverSingleResult(generateContentArgs, result, generateContent))
        .filter((item) => item.type === 'functionCall')
        .map((item) => item.functionCall);

      expect(askQuestionCalls.length).toBe(1);
      const askExploreDeeperCall = askQuestionCalls[0];

      expect(askExploreDeeperCall).toBeDefined();
      expect(askExploreDeeperCall?.args?.actionType).toBe('exploreExternalDirectories');
      expect(askExploreDeeperCall?.args?.message).toMatch(/explore/i);
      expect(askExploreDeeperCall?.args?.message).toContain(deeperDir); // Check if it mentions the target 'src' dir

      console.log(
        `Test 3 (${modelType} - ${service}): Passed - Correctly decided to explore deeper based on synthesis.`,
      );
    });

    // NEW TEST CASE 1: Verify suggestion of conversationGraph
    it('should suggest conversationGraph for multi-step external exploration', async () => {
      const userPromptText = 'Find log files in /external/logs, read them, and summarize any critical errors.';

      const currentPrompt: PromptItem[] = [
        { type: 'systemPrompt', systemPrompt: getSystemPrompt(mockRcConfig as RcConfig, currentOptions) },
        { type: 'user', text: userPromptText },
      ];

      const generateContentArgs: Parameters<GenerateContentFunction> = [
        currentPrompt,
        {
          functionDefs: getFunctionDefs(),
          requiredFunctionName: 'askQuestion', // Expecting the initial response to be askQuestion
          modelType,
          temperature: 0.2,
        },
        currentOptions,
      ];

      const result = await generateContent(...generateContentArgs);
      const askQuestionCalls = (await validateAndRecoverSingleResult(generateContentArgs, result, generateContent))
        .filter((item) => item.type === 'functionCall')
        .map((item) => item.functionCall as AskQuestionCall);

      expect(askQuestionCalls.length).toBe(1);
      const askGraphCall = askQuestionCalls[0];

      console.log(JSON.stringify(askGraphCall, null, 2));

      expect(askGraphCall).toBeDefined();
      // Check if the model suggests using a conversation graph for this multi-step task
      expect(askGraphCall.args?.actionType).toBe('conversationGraph');
      expect(askGraphCall.args?.message).toMatch(/plan|steps|structured approach|graph/i); // Check message suggests planning

      console.log(`Test 4 (${modelType} - ${service}): Passed - Correctly suggested conversationGraph.`);
    });

    // NEW TEST CASE 2: Verify generation of conversationGraph with external nodes
    it('should generate conversationGraph with external exploration nodes', async () => {
      const userPromptText = 'Find log files in /external/logs, read them, and summarize any critical errors.';
      const externalDir = '/external/logs';

      // Simulate the conversation leading up to graph generation
      const currentPrompt: PromptItem[] = [
        { type: 'systemPrompt', systemPrompt: getSystemPrompt(mockRcConfig as RcConfig, currentOptions) },
        { type: 'user', text: userPromptText },
        {
          type: 'assistant',
          text: 'Okay, I can help you with that. I will first explore the `/external/logs` directory to find the log files, then read their content, and finally summarize any critical errors I find. Is that okay?',
        },
        {
          type: 'user',
          text: CONVERSATION_GRAPH_PROMPT,
        },
      ];

      const generateContentArgs: Parameters<GenerateContentFunction> = [
        currentPrompt,
        {
          functionDefs: getFunctionDefs(),
          requiredFunctionName: 'conversationGraph', // Expecting the graph generation call
          modelType: ModelType.DEFAULT,
          temperature: 0.7, // Allow more creativity for graph generation
        },
        currentOptions,
      ];

      const result = await generateContent(...generateContentArgs);
      const graphCalls = (await validateAndRecoverSingleResult(generateContentArgs, result, generateContent))
        .filter((item) => item.type === 'functionCall')
        .map((item) => item.functionCall as FunctionCall<ConversationGraphArgs>);

      expect(graphCalls.length).toBe(1);
      const graphArgs = graphCalls[0].args;

      console.log(JSON.stringify(graphArgs, null, 2));

      expect(graphArgs).toBeDefined();
      expect(graphArgs?.nodes).toBeInstanceOf(Array);
      expect(graphArgs?.edges).toBeInstanceOf(Array);
      expect(graphArgs?.entryNode).toBeDefined();

      // Verify presence of external exploration nodes
      const exploreNode = graphArgs?.nodes.find((node) => node.actionType === 'exploreExternalDirectories');
      const readNode = graphArgs?.nodes.find((node) => node.actionType === 'readExternalFiles');

      expect(exploreNode, 'Graph should contain an exploreExternalDirectories node').toBeDefined();
      expect(readNode, 'Graph should contain a readExternalFiles node').toBeDefined();

      // Verify the explore node instruction targets the correct directory
      expect(exploreNode?.instruction).toContain(externalDir);

      // Verify an edge connects exploration to reading
      const exploreToReadEdge = graphArgs?.edges.find(
        (edge) => edge.sourceNode === exploreNode?.id && edge.targetNode === readNode?.id,
      );
      expect(exploreToReadEdge, 'Graph should contain an edge from explore to read node').toBeDefined();

      console.log(
        `Test 5 (${modelType} - ${service}): Passed - Correctly generated conversationGraph with external nodes.`,
      );
    });

    // Keep existing integration tests (renumbered)
    it('should integrate conversationGraph with exploreExternalDirectories (original test 4)', async () => {
      const externalDir = '/external/project-c';
      const foundFiles = [`${externalDir}/main.log`, `${externalDir}/error.log`];

      const graph: ConversationGraphArgs = {
        entryNode: 'start' as ConversationNodeId,
        nodes: [
          {
            id: 'start' as ConversationNodeId,
            actionType: 'sendMessage',
            instruction: 'Initiate analysis of external logs.',
          },
          {
            id: 'exploreLogs' as ConversationNodeId,
            actionType: 'exploreExternalDirectories',
            instruction: `Explore the log directory: ${externalDir}`,
          },
          {
            id: 'readLogs' as ConversationNodeId,
            actionType: 'readExternalFiles',
            instruction: 'Read the discovered log files.',
          },
        ],
        edges: [
          {
            sourceNode: 'start' as ConversationNodeId,
            targetNode: 'exploreLogs' as ConversationNodeId,
            instruction: 'Proceed to explore logs.',
          },
          {
            sourceNode: 'exploreLogs' as ConversationNodeId,
            targetNode: 'readLogs' as ConversationNodeId,
            instruction: 'If log files are found, proceed to read them.',
          },
        ],
      };

      // Mock the tool response for exploration
      const exploreToolResponse: PromptItem = {
        type: 'user',
        functionResponses: [
          {
            name: exploreExternalDirectoriesDef.name,
            call_id: 'mock_graph_explore_call_id',
            content: JSON.stringify({
              requestedDirectories: [externalDir],
              reason: 'Find log files',
              fileCount: foundFiles.length,
              filePaths: foundFiles,
            }),
          },
        ],
        text: 'Exploration complete.',
      };

      // --- Test Execution --- Focus on the step *after* exploreLogs node execution
      const currentPrompt: PromptItem[] = [
        { type: 'systemPrompt', systemPrompt: getSystemPrompt(mockRcConfig as RcConfig, currentOptions) },
        { type: 'user', text: 'Analyze logs in /external/project-c' },
        {
          type: 'assistant',
          text: 'Okay, starting analysis. First, I need to explore the directory.',
          // Simulate graph being active and triggering the explore action via askQuestion
          functionCalls: [
            {
              id: 'mock_graph_explore_call_id', // ID for the explore call triggered by the graph node
              name: 'askQuestion', // The graph node action translates to an askQuestion call
              args: {
                actionType: 'exploreExternalDirectories',
                message: `Exploring ${externalDir}...`,
              },
            },
          ],
        },
        exploreToolResponse, // Add the result of the exploration
      ];

      // We expect the next step to be evaluating the edge from 'exploreLogs' to 'readLogs'
      const generateContentArgs: Parameters<GenerateContentFunction> = [
        [
          ...currentPrompt,
          {
            type: 'user', // Simulate the prompt for edge evaluation
            text: getEdgeEvaluationPrompt(
              graph.nodes.find((n) => n.id === 'exploreLogs')!,
              graph.edges.filter((e) => e.sourceNode === 'exploreLogs'),
            ),
          },
        ],
        {
          functionDefs: getFunctionDefs(),
          requiredFunctionName: 'evaluateEdge', // Expecting edge evaluation
          modelType,
          temperature: 0.2,
        },
        currentOptions,
      ];

      const result: GenerateContentResult = await generateContent(...generateContentArgs);
      const evaluateEdgeCalls = (await validateAndRecoverSingleResult(generateContentArgs, result, generateContent))
        .filter((item) => item.type === 'functionCall')
        .map((item) => item.functionCall as FunctionCall<EvaluateEdgeArgs>);

      expect(evaluateEdgeCalls.length).toBe(1);
      const edgeEval = evaluateEdgeCalls[0].args;
      expect(edgeEval).toBeDefined();
      expect(edgeEval?.shouldTerminate).toBe(false);
      expect(edgeEval?.selectedEdge).toBeDefined();
      expect(edgeEval?.selectedEdge?.sourceNode).toBe('exploreLogs');
      expect(edgeEval?.selectedEdge?.targetNode).toBe('readLogs'); // Should decide to move to reading logs

      console.log(
        `Test 6 (${modelType} - ${service}): Passed - Graph correctly transitioned from explore to read logs.`,
      );
    });

    it('should integrate conversationGraph with readExternalFiles (original test 5)', async () => {
      const externalDir = '/external/project-d';
      const logFiles = [`${externalDir}/app.log`, `${externalDir}/audit.log`];
      const processedLogContent = 'Found 2 critical errors in app.log.';

      const graph: ConversationGraphArgs = {
        entryNode: 'explore' as ConversationNodeId,
        nodes: [
          {
            id: 'explore' as ConversationNodeId,
            actionType: 'exploreExternalDirectories',
            instruction: `Explore the log directory: ${externalDir}`,
          },
          {
            id: 'read' as ConversationNodeId,
            actionType: 'readExternalFiles',
            instruction: 'Read the discovered log files.',
          },
          {
            id: 'analyze' as ConversationNodeId,
            actionType: 'sendMessage', // Or performAnalysis
            instruction: 'Analyze the content of the log files.',
          },
        ],
        edges: [
          {
            sourceNode: 'explore' as ConversationNodeId,
            targetNode: 'read' as ConversationNodeId,
            instruction: 'If log files are found, proceed to read them.',
          },
          {
            sourceNode: 'read' as ConversationNodeId,
            targetNode: 'analyze' as ConversationNodeId,
            instruction: 'If log files were read successfully, proceed to analyze their content.',
          },
        ],
      };

      // Mock the tool response for reading files
      const readToolResponse: PromptItem = {
        type: 'user',
        functionResponses: [
          {
            name: readExternalFilesDef.name,
            call_id: 'mock_graph_read_call_id',
            content: JSON.stringify({
              externalFilePaths: logFiles,
              reason: 'Analyze logs',
              fileResults: logFiles.map((f) => ({
                filePath: f,
                result: f.includes('app.log') ? processedLogContent : 'No relevant info found.',
              })),
            }),
          },
        ],
        text: 'File reading complete.',
      };

      // --- Test Execution --- Focus on the step *after* readLogs node execution
      const currentPrompt: PromptItem[] = [
        { type: 'systemPrompt', systemPrompt: getSystemPrompt(mockRcConfig as RcConfig, currentOptions) },
        { type: 'user', text: 'Analyze logs in /external/project-d' },
        // ... assume previous graph steps (explore) happened ...
        {
          type: 'assistant',
          text: 'Okay, found the log files. Now I need to read them.',
          // Simulate graph triggering the read action
          functionCalls: [
            {
              id: 'mock_graph_read_call_id', // ID for the read call
              name: 'askQuestion',
              args: {
                actionType: 'readExternalFiles',
                message: `Reading ${logFiles.join(', ')}...`,
              },
            },
          ],
        },
        readToolResponse, // Add the result of reading the files
      ];

      // We expect the next step to be evaluating the edge from 'read' to 'analyze'
      const generateContentArgs: Parameters<GenerateContentFunction> = [
        [
          ...currentPrompt,
          {
            type: 'user', // Simulate the prompt for edge evaluation
            text: getEdgeEvaluationPrompt(
              graph.nodes.find((n) => n.id === 'read')!,
              graph.edges.filter((e) => e.sourceNode === 'read'),
            ),
          },
        ],
        {
          functionDefs: getFunctionDefs(),
          requiredFunctionName: 'evaluateEdge', // Expecting edge evaluation
          modelType,
          temperature: 0.2,
        },
        currentOptions,
      ];

      const result: GenerateContentResult = await generateContent(...generateContentArgs);
      const evaluateEdgeCalls = (await validateAndRecoverSingleResult(generateContentArgs, result, generateContent))
        .filter((item) => item.type === 'functionCall')
        .map((item) => item.functionCall as FunctionCall<EvaluateEdgeArgs>);

      expect(evaluateEdgeCalls.length).toBe(1);
      const edgeEval = evaluateEdgeCalls[0].args;
      expect(edgeEval).toBeDefined();
      expect(edgeEval?.shouldTerminate).toBe(false);
      expect(edgeEval?.selectedEdge).toBeDefined();
      expect(edgeEval?.selectedEdge?.sourceNode).toBe('read');
      expect(edgeEval?.selectedEdge?.targetNode).toBe('analyze'); // Should decide to move to analysis

      console.log(
        `Test 7 (${modelType} - ${service}): Passed - Graph correctly transitioned from read to analyze content.`,
      );
    });

    // Add more tests for:
    // - Handling errors from exploreExternalDirectories (e.g., directory not found) -> LLM should inform user / graph should handle error edge
    // - Handling readExternalFiles errors (file not found, access denied) -> LLM should inform user / graph should handle error edge
    // - Cases where synthesis is unclear -> LLM should ask user for clarification / graph needs clarification node
  },
);
