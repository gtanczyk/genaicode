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
  GRAPH_ANALYSIS_PROMPT_TEXT, // Import analysis prompt
  GRAPH_REVISION_PROMPT_TEXT, // Import revision prompt
  getEdgeEvaluationPrompt,
} from '../prompt/steps/step-ask-question/handlers/handle-conversation-graph.js';
import {
  ConversationNodeId,
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
    const result = (
      await generateContent(
        prompt,
        {
          functionDefs: getFunctionDefs(),
          requiredFunctionName: 'conversationGraph',
          temperature: 0.7,
          modelType: ModelType.DEFAULT,
        },
        {},
      )
    )
      .filter((item) => item.type === 'functionCall')
      .map((item) => item.functionCall) as [FunctionCall<ConversationGraphArgs>];

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
    {
      userResponse:
        "Yes, I think I'm ready to implement, but maybe just a quick sanity check on the requirements again before I start planning the details?",
      expectedEdge: 'modifyRequirements',
    },
    {
      userResponse:
        "Regarding the context optimization, will it also handle cases where the context exceeds the model's token limit, or is it only for general optimization within the limit?",
      expectedEdge: 'gatherInfo',
    },
    {
      userResponse:
        "I said I'm ready to implement, but actually, after thinking about it more, I think we should first refine the requirements a bit. Let's modify the requirements first.",
      expectedEdge: 'modifyRequirements',
    },
  ])('should evaluate edges in a conversation graph: $expectedEdge', async ({ userResponse, expectedEdge }) => {
    const conversationGraph: ConversationGraphArgs = {
      entryNode: 'start' as ConversationNodeId,
      nodes: [
        {
          id: 'start' as ConversationNodeId,
          actionType: 'sendMessage',
          instruction: "Initial assessment of feature development request. Ask about user's readiness and preferences.",
        },
        {
          id: 'gatherInfo' as ConversationNodeId,
          actionType: 'sendMessage',
          instruction: 'Gather more information about feature requirements and constraints.',
        },
        {
          id: 'planImplementation' as ConversationNodeId,
          actionType: 'sendMessage',
          instruction: 'Plan the implementation steps and discuss technical approach.',
        },
        {
          id: 'modifyRequirements' as ConversationNodeId,
          actionType: 'sendMessage',
          instruction: 'Discuss and refine feature requirements.',
        },
        {
          id: 'confirmCodegen' as ConversationNodeId,
          actionType: 'confirmCodeGeneration',
          instruction: 'Confirm readiness to proceed with code generation.',
        },
      ],
      edges: [
        {
          sourceNode: 'start' as ConversationNodeId,
          targetNode: 'gatherInfo' as ConversationNodeId,
          instruction: 'User needs more information or clarification about the feature before proceeding.',
        },
        {
          sourceNode: 'start' as ConversationNodeId,
          targetNode: 'planImplementation' as ConversationNodeId,
          instruction: 'User has clear requirements and wants to proceed with implementation.',
        },
        {
          sourceNode: 'start' as ConversationNodeId,
          targetNode: 'modifyRequirements' as ConversationNodeId,
          instruction: 'User wants to modify or refine the feature requirements.',
        },
        {
          sourceNode: 'gatherInfo' as ConversationNodeId,
          targetNode: 'planImplementation' as ConversationNodeId,
          instruction: 'After gathering information, proceed with implementation planning.',
        },
        {
          sourceNode: 'modifyRequirements' as ConversationNodeId,
          targetNode: 'planImplementation' as ConversationNodeId,
          instruction: 'After modifying requirements, proceed with implementation planning.',
        },
        {
          sourceNode: 'planImplementation' as ConversationNodeId,
          targetNode: 'confirmCodegen' as ConversationNodeId,
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
    const [result] = (
      await generateContent(
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
        {
          functionDefs: getFunctionDefs(),
          requiredFunctionName: 'evaluateEdge',
          temperature: 0.7,
          modelType: ModelType.CHEAP,
        },
        {},
      )
    )
      .filter((item) => item.type === 'functionCall')
      .map((item) => item.functionCall) as [FunctionCall<EvaluateEdgeArgs>];

    console.log('Edge Evaluation Result:', JSON.stringify(result, null, 2));

    // Verify the response
    expect(result).toBeDefined();
    expect(result.args).toBeDefined();
    expect(result.args?.reasoning).toBeDefined();

    if (expectedEdge) {
      expect(result.args?.selectedEdge).toBeDefined();
      expect(result.args?.shouldTerminate).toBe(false);
    } else {
      // Allow selectedEdge to be null or undefined if terminating
      expect(result.args?.shouldTerminate).toBe(true);
    }

    // Only check targetNode if an edge was expected and selected
    if (expectedEdge && result.args?.selectedEdge) {
      expect(result.args.selectedEdge.targetNode).toBe(expectedEdge);
    }
  });

  it('should test graph, find problems, and improve it', async () => {
    // prepare context with some existing conversation graph which has a problem
    // example problem: the graph is not connected, or there are no edges to a terminal node
    const conversationGraph: ConversationGraphArgs = {
      entryNode: 'start' as ConversationNodeId,
      nodes: [
        {
          id: 'start' as ConversationNodeId,
          actionType: 'sendMessage',
          instruction: "Initial assessment of feature development request. Ask about user's readiness and preferences.",
        },
        {
          id: 'gatherInfo' as ConversationNodeId,
          actionType: 'sendMessage',
          instruction: 'Gather more information about feature requirements and constraints.',
        },
        {
          id: 'planImplementation' as ConversationNodeId,
          actionType: 'sendMessage',
          instruction: 'Plan the implementation steps and discuss technical approach.',
        },
        {
          id: 'modifyRequirements' as ConversationNodeId,
          actionType: 'sendMessage',
          instruction: 'Discuss and refine feature requirements.',
        },
        {
          id: 'confirmCodegen' as ConversationNodeId,
          actionType: 'confirmCodeGeneration',
          instruction: 'Confirm readiness to proceed with code generation.',
        },
        // These nodes are disconnected/problematic
        {
          id: 'testCode' as ConversationNodeId,
          actionType: 'sendMessage', // Should be a tool call?
          instruction: 'Test the generated code and provide feedback.',
        },
        {
          id: 'reviewCode' as ConversationNodeId,
          actionType: 'sendMessage',
          instruction: 'Review the generated code and provide feedback.',
        },
        {
          id: 'deployCode' as ConversationNodeId,
          actionType: 'sendMessage',
          instruction: 'Deploy the generated code to production.',
        },
        {
          id: 'cancel' as ConversationNodeId,
          actionType: 'endConversation',
          instruction: 'Cancel the feature development process.',
        },
      ],
      edges: [
        {
          sourceNode: 'start' as ConversationNodeId,
          targetNode: 'gatherInfo' as ConversationNodeId,
          instruction: 'User needs more information or clarification about the feature before proceeding.',
        },
        {
          sourceNode: 'start' as ConversationNodeId,
          targetNode: 'planImplementation' as ConversationNodeId,
          instruction: 'User has clear requirements and wants to proceed with implementation.',
        },
        {
          sourceNode: 'start' as ConversationNodeId,
          targetNode: 'modifyRequirements' as ConversationNodeId,
          instruction: 'User wants to modify or refine the feature requirements.',
        },
        {
          sourceNode: 'gatherInfo' as ConversationNodeId,
          targetNode: 'planImplementation' as ConversationNodeId,
          instruction: 'After gathering information, proceed with implementation planning.',
        },
        {
          sourceNode: 'modifyRequirements' as ConversationNodeId,
          targetNode: 'planImplementation' as ConversationNodeId,
          instruction: 'After modifying requirements, proceed with implementation planning.',
        },
        {
          sourceNode: 'planImplementation' as ConversationNodeId,
          targetNode: 'confirmCodegen' as ConversationNodeId,
          instruction: 'Ready to proceed with code generation.',
        },
        // Missing edges from confirmCodegen to testCode/reviewCode/deployCode/cancel
        // E.g., edge from confirmCodegen to cancel is missing
      ],
    };
    // Prepare prompt items for testing
    const prompt: PromptItem[] = [
      {
        type: 'assistant',
        text: 'I have prepared a conversation graph for you.',
        functionCalls: [{ name: 'conversationGraph', args: conversationGraph }],
      },
      {
        type: 'user',
        // Use the imported analysis prompt text
        text: GRAPH_ANALYSIS_PROMPT_TEXT,
        functionResponses: [{ name: 'conversationGraph', content: '' }],
      },
    ];

    // Execute graph testing (expecting text analysis)
    const [analysisResult] = await generateContent(
      prompt,
      {
        functionDefs: getFunctionDefs(),
        temperature: 0.7,
        modelType: ModelType.CHEAP,
        expectedResponseType: { text: true, functionCall: false, media: false },
      },
      {},
    );

    if (analysisResult.type !== 'text') {
      throw new Error('Expected text response for graph testing');
    }
    console.log('Graph Testing Result:', analysisResult.text);
    // Basic check that analysis mentions problems
    expect(analysisResult.text).toMatch(/problem|issue|missing|unreachable|disconnected/i);

    // Generate a new graph based on the testing result
    const [revisionResult] = await generateContent(
      [
        ...prompt,
        {
          type: 'assistant',
          text: analysisResult.text, // Add the analysis text to history
        },
        {
          type: 'user',
          // Use the imported revision prompt text
          text: GRAPH_REVISION_PROMPT_TEXT,
        },
      ],
      {
        functionDefs: getFunctionDefs(),
        requiredFunctionName: 'conversationGraph',
        temperature: 0.7,
        modelType: ModelType.CHEAP,
        expectedResponseType: { text: false, functionCall: true, media: false },
      },
      {},
    );

    if (revisionResult.type !== 'functionCall' || revisionResult.functionCall.name !== 'conversationGraph') {
      throw new Error('Expected conversationGraph function call response for graph revision');
    }

    console.log('New Graph:', JSON.stringify(revisionResult.functionCall.args, null, 2));
    const newGraph = revisionResult.functionCall?.args as ConversationGraphArgs;
    expect(newGraph).toBeDefined();
    expect(newGraph.nodes).toBeDefined();
    expect(newGraph.edges).toBeDefined();

    // Generate a diff between the old and new graph
    const oldGraph = conversationGraph;
    const oldGraphNodes = new Set(oldGraph.nodes.map((node) => node.id));
    const newGraphNodes = new Set(newGraph.nodes.map((node) => node.id));
    const oldGraphEdges = new Set(oldGraph.edges.map((edge) => `${edge.sourceNode}->${edge.targetNode}`));
    const newGraphEdges = new Set(newGraph.edges.map((edge) => `${edge.sourceNode}->${edge.targetNode}`));
    const addedNodes = newGraph.nodes.filter((node) => !oldGraphNodes.has(node.id));
    const removedNodes = oldGraph.nodes.filter((node) => !newGraphNodes.has(node.id));
    const addedEdges = newGraph.edges.filter((edge) => !oldGraphEdges.has(`${edge.sourceNode}->${edge.targetNode}`));
    const removedEdges = oldGraph.edges.filter((edge) => !newGraphEdges.has(`${edge.sourceNode}->${edge.targetNode}`));
    const modifiedNodes = newGraph.nodes.filter((newNode) => {
      const oldNode = oldGraph.nodes.find((n) => n.id === newNode.id);
      return oldNode && (newNode.actionType !== oldNode.actionType || newNode.instruction !== oldNode.instruction);
    });
    const modifiedEdges = newGraph.edges.filter((newEdge) => {
      const oldEdge = oldGraph.edges.find(
        (e) => e.sourceNode === newEdge.sourceNode && e.targetNode === newEdge.targetNode,
      );
      return oldEdge && newEdge.instruction !== oldEdge.instruction;
    });

    const diff = {
      addedNodes,
      removedNodes,
      addedEdges,
      removedEdges,
      modifiedNodes,
      modifiedEdges,
    };
    console.log('Graph Diff:', JSON.stringify(diff, null, 2));

    // Verify that the diff shows changes, indicating the graph was likely improved
    // Specifically check if edges were added (likely fixing the disconnection)
    expect(diff.addedEdges.length).toBeGreaterThan(0);
    // Check if the problematic nodes are now connected
    const confirmCodegenEdges = newGraph.edges.filter((e) => e.sourceNode === 'confirmCodegen');
    expect(confirmCodegenEdges.length).toBeGreaterThan(0); // Should have edges leaving confirmCodegen now
    // Optionally check if specific expected edges were added (e.g., to 'cancel' or 'testCode')
    expect(confirmCodegenEdges.some((e) => e.targetNode === 'cancel')).toBe(true);
  });
});
