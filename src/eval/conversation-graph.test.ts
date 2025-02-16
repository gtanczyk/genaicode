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
import { CONVERSATION_GRAPH_DOCS } from '../prompt/steps/step-ask-question/handlers/handle-conversation-graph.js';
import { ConversationGraphArgs } from '../prompt/function-defs/conversation-graph.js';

vi.setConfig({
  testTimeout: 3 * 60000,
});

describe.each([
  { model: 'Gemini Pro', generateContent: generateContentAiStudio, modelType: ModelType.DEFAULT },
  { model: 'Claude Sonnet', generateContent: generateContentAnthropic, modelType: ModelType.DEFAULT },
  { model: 'GPT-4o', generateContent: generateContentOpenAI, modelType: ModelType.DEFAULT },
])('Conversation Graph: $model', ({ generateContent, modelType }) => {
  generateContent = retryGenerateContent(generateContent);

  it('should generate a valid conversation graph', async () => {
    // Prepare prompt items for testing
    const prompt: PromptItem[] = [
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
      {
        type: 'assistant',
        text: 'I can help you with this, let me think how we can go through this.',
      },
      {
        type: 'user',
        text: CONVERSATION_GRAPH_DOCS,
      },
    ];

    // Execute conversation graph generation
    const result = (await generateContent(prompt, getFunctionDefs(), 'conversationGraph', 0.2, modelType)) as [
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
});
