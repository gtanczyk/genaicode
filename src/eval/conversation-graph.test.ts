import { describe, it, expect, vi } from 'vitest';
import { generateContent as generateContentAiStudio } from '../ai-service/ai-studio.js';
import { generateContent as generateContentAnthropic } from '../ai-service/anthropic.js';
import { generateContent as generateContentOpenAI } from '../ai-service/openai.js';
import { getFunctionDefs } from '../prompt/function-calling.js';
import { FunctionCall, PromptItem } from '../ai-service/common-types.js';
import { ModelType } from '../ai-service/common-types.js';
import { getSystemPrompt } from '../prompt/systemprompt.js';
import {
  INITIAL_GREETING,
  READY_TO_ASSIST,
  REQUEST_SOURCE_CODE,
  SOURCE_CODE_RESPONSE,
} from '../prompt/static-prompts.js';
import { retryGenerateContent } from './test-utils/generate-content-retry.js';
import {
  CONVERSATION_GRAPH_PROMPT,
  getEdgeEvaluationPrompt,
} from '../prompt/steps/step-ask-question/handlers/handle-conversation-graph.js';
import {
  ConverationNodeId,
  ConversationGraphArgs,
  EvaluateEdgeArgs,
} from '../prompt/function-defs/conversation-graph.js';

vi.setConfig({
  testTimeout: 3 * 60000,
});

describe.each([
  { model: 'Gemini', generateContent: generateContentAiStudio },
  { model: 'Claude ', generateContent: generateContentAnthropic },
  { model: 'GPT-4o', generateContent: generateContentOpenAI },
])('Conversation Graph: $model', ({ generateContent }) => {
  generateContent = retryGenerateContent(generateContent);

  const PROMPT_PREFIX: PromptItem[] = [
    {
      type: 'systemPrompt',
      systemPrompt: getSystemPrompt(
        { rootDir: '/project' },
        {
          askQuestion: true,
          ui: true,
          allowFileCreate: true,
          allowFileDelete: true,
          allowDirectoryCreate: true,
          allowFileMove: true,
          vision: true,
          imagen: 'vertex-ai',
          aiService: 'vertex-ai',
        },
      ),
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
          content: JSON.stringify({}),
        },
      ],
    },
    {
      type: 'assistant',
      text: READY_TO_ASSIST,
    },
    {
      type: 'user',
      text: 'We will be developing a new feature for the project.',
    },
  ];

  it('should generate a valid conversation graph', async () => {
    // Prepare prompt items for testing
    const prompt: PromptItem[] = [
      ...PROMPT_PREFIX,
      {
        type: 'assistant',
        text: 'I can help you with this, let me think how we can go through this.',
      },
      {
        type: 'user',
        text: CONVERSATION_GRAPH_PROMPT,
      },
    ];

    // Execute conversation graph generation
    const result = (await generateContent(prompt, getFunctionDefs(), 'conversationGraph', 0.7, ModelType.DEFAULT)) as [
      FunctionCall<ConversationGraphArgs>,
    ];

    // Verify the response structure
    expect(result).toBeDefined();
    expect(result.length).toBe(1);
    const [conversationGraphCall] = result;
    expect(conversationGraphCall.name).toBe('conversationGraph');
    expect(conversationGraphCall.args).toBeDefined();

    console.log('Conversation Graph:', JSON.stringify(conversationGraphCall.args, null, 2));

    // Verify graph contains nodes and edges
    const { entryNode, nodes, edges } = conversationGraphCall.args!;
    expect(nodes).toBeDefined();
    expect(nodes.length).toBeGreaterThan(0);
    expect(edges).toBeDefined();
    expect(edges.length).toBeGreaterThan(0);

    // Verify entry node
    expect(nodes.find((node) => node.id === entryNode)).toBeDefined();

    // Verify if all edges refer to existing nodes
    const nodeIds = new Set(nodes.map((node) => node.id));
    for (const edge of edges) {
      expect(nodeIds.has(edge.sourceNode)).toBe(true);
      expect(nodeIds.has(edge.targetNode)).toBe(true);
    }
  });

  it.each([
    {
      userResponse:
        "I have a clear idea of the feature I want to implement. It's a new context optimization feature that will help reduce token usage.",
      expectedEdge: 'planImplementation',
    },
    {
      userResponse:
        "I'm not sure about the feature requirements. I need more information about the context optimization feature.",
      expectedEdge: 'gatherInfo',
    },
    {
      userResponse: 'I want to modify the feature requirements. I need to refine the context optimization feature.',
      expectedEdge: 'modifyRequirements',
    },
    {
      userResponse: 'I want to cancel the feature development.',
      expectedEdge: undefined,
    },
  ])('should evaluate edges in a conversation graph: $expectedEdge', async ({ userResponse, expectedEdge }) => {
    const conversationGraph: ConversationGraphArgs = {
      entryNode: 'start' as ConverationNodeId,
      nodes: [
        {
          id: 'start' as ConverationNodeId,
          actionType: 'sendMessage',
          instruction: "Initial assessment of feature development request. Ask about user's readiness and preferences.",
        },
        {
          id: 'gatherInfo' as ConverationNodeId,
          actionType: 'sendMessage',
          instruction: 'Gather more information about feature requirements and constraints.',
        },
        {
          id: 'planImplementation' as ConverationNodeId,
          actionType: 'sendMessage',
          instruction: 'Plan the implementation steps and discuss technical approach.',
        },
        {
          id: 'modifyRequirements' as ConverationNodeId,
          actionType: 'sendMessage',
          instruction: 'Discuss and refine feature requirements.',
        },
        {
          id: 'confirmCodegen' as ConverationNodeId,
          actionType: 'confirmCodeGeneration',
          instruction: 'Confirm readiness to proceed with code generation.',
        },
      ],
      edges: [
        {
          sourceNode: 'start' as ConverationNodeId,
          targetNode: 'gatherInfo' as ConverationNodeId,
          instruction: 'User needs more information or clarification about the feature before proceeding.',
        },
        {
          sourceNode: 'start' as ConverationNodeId,
          targetNode: 'planImplementation' as ConverationNodeId,
          instruction: 'User has clear requirements and wants to proceed with implementation.',
        },
        {
          sourceNode: 'start' as ConverationNodeId,
          targetNode: 'modifyRequirements' as ConverationNodeId,
          instruction: 'User wants to modify or refine the feature requirements.',
        },
        {
          sourceNode: 'gatherInfo' as ConverationNodeId,
          targetNode: 'planImplementation' as ConverationNodeId,
          instruction: 'After gathering information, proceed with implementation planning.',
        },
        {
          sourceNode: 'modifyRequirements' as ConverationNodeId,
          targetNode: 'planImplementation' as ConverationNodeId,
          instruction: 'After modifying requirements, proceed with implementation planning.',
        },
        {
          sourceNode: 'planImplementation' as ConverationNodeId,
          targetNode: 'confirmCodegen' as ConverationNodeId,
          instruction: 'Ready to proceed with code generation.',
        },
      ],
    };

    // Prepare prompt items for testing
    const prompt: PromptItem[] = [
      ...PROMPT_PREFIX,
      {
        type: 'assistant',
        text: "I'll help you develop the new feature. First, let me understand your current position with this feature development.",
        functionCalls: [{ name: 'conversationGraph', args: conversationGraph }],
      },
      {
        type: 'user',
        text: userResponse,
        functionResponses: [{ name: 'conversationGraph', content: '' }],
      },
    ];

    // Execute edge evaluation
    const [result] = (await generateContent(
      [
        ...prompt,
        {
          type: 'user',
          text: getEdgeEvaluationPrompt(
            conversationGraph.nodes[0],
            conversationGraph.edges.filter((edge) => edge.sourceNode === 'start'),
          ),
        },
      ],
      getFunctionDefs(),
      'evaluateEdge',
      0.7,
      ModelType.CHEAP,
    )) as [FunctionCall<EvaluateEdgeArgs>];

    console.log('Edge Evaluation Result:', JSON.stringify(result, null, 2));

    // Verify the response
    expect(result).toBeDefined();
    expect(result.args).toBeDefined();
    expect(result.args?.reasoning).toBeDefined();

    if (expectedEdge) {
      expect(result.args?.selectedEdge).toBeDefined();
      expect(result.args?.shouldTerminate).toBe(false);
    } else {
      expect(result.args?.selectedEdge).not.toBeDefined();
      expect(result.args?.shouldTerminate).toBe(true);
    }

    expect(result.args?.selectedEdge?.targetNode).toBe(expectedEdge);
  });
});
