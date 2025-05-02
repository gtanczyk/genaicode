import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  handleConversationGraph,
  CONVERSATION_GRAPH_PROMPT,
  GRAPH_ANALYSIS_PROMPT_TEXT,
  GRAPH_REVISION_PROMPT_TEXT,
} from './handle-conversation-graph.js';
import { ActionHandlerProps } from '../step-ask-question-types.js'; // Removed ActionResult, AskQuestionCall, UserConfirmationResult
import { getActionHandler } from '../ask-question-handler.js';
import * as contentBus from '../../../../main/common/content-bus.js';
import * as userActions from '../../../../main/common/user-actions.js';
import { ModelType, PromptItem, FunctionCall } from '../../../../ai-service/common-types.js';
import {
  ConversationGraphArgs,
  ConversationGraphCall,
  EvaluateEdgeCall,
  ConversationNodeId,
  // Removed ConversationNode, ConversationEdge
} from '../../../function-defs/conversation-graph.js';
import { SendMessageArgs } from '../step-ask-question-types.js'; // Removed EvaluateEdgeArgs
import { CodegenOptions } from '../../../../main/codegen-types.js';

// Mocks
vi.mock('../ask-question-handler.js');
vi.mock('../../../../main/common/content-bus.js');
vi.mock('../../../../main/common/user-actions.js');

const mockGenerateContentFn = vi.fn();
const mockGenerateImageFn = vi.fn();
const mockWaitIfPaused = vi.fn().mockResolvedValue(undefined);
const mockGetActionHandler = vi.mocked(getActionHandler);
const mockPutSystemMessage = vi.mocked(contentBus.putSystemMessage);
const mockPutUserMessage = vi.mocked(contentBus.putUserMessage);
const mockPutAssistantMessage = vi.mocked(contentBus.putAssistantMessage);
const mockAskUserForConfirmationWithAnswer = vi.mocked(userActions.askUserForConfirmationWithAnswer);

// Default Mocks
const mockSendMessageHandler = vi.fn().mockResolvedValue({ breakLoop: false, items: [] });

const defaultGraph: ConversationGraphArgs = {
  entryNode: 'start' as ConversationNodeId,
  nodes: [
    { id: 'start' as ConversationNodeId, actionType: 'sendMessage', instruction: 'Start node instruction' },
    { id: 'next' as ConversationNodeId, actionType: 'sendMessage', instruction: 'Next node instruction' },
  ],
  edges: [
    { sourceNode: 'start' as ConversationNodeId, targetNode: 'next' as ConversationNodeId, instruction: 'Go to next' },
  ],
};

const defaultGraphCall: ConversationGraphCall = {
  id: 'graph-call-1',
  name: 'conversationGraph',
  args: defaultGraph,
};

const revisedGraphCall: ConversationGraphCall = {
  // Simulate a revised graph call
  id: 'revised-graph-call',
  name: 'conversationGraph',
  args: defaultGraph, // Using same args for simplicity
};

const defaultEvaluateEdgeCall: EvaluateEdgeCall = {
  id: 'eval-call-1',
  name: 'evaluateEdge',
  args: {
    reasoning: 'Move to next node',
    selectedEdge: defaultGraph.edges[0],
    shouldTerminate: false,
  },
};

const defaultSendMessageCall: FunctionCall<SendMessageArgs> = {
  id: 'send-msg-call-1',
  name: 'sendMessage',
  args: {
    message: 'Generated message for node',
  },
};

describe('handleConversationGraph', () => {
  let props: ActionHandlerProps;
  let initialPrompt: PromptItem[];

  beforeEach(() => {
    vi.clearAllMocks();
    initialPrompt = [{ type: 'user', text: 'Initial user prompt' }];
    props = {
      askQuestionCall: {
        name: 'askQuestion',
        args: {
          message: 'Assistant wants to start graph',
          actionType: 'conversationGraph',
        },
      },
      prompt: [...initialPrompt], // Clone initial prompt
      options: { ui: false, aiService: 'vertex-ai', askQuestion: true } as CodegenOptions, // Removed rootDir, added mandatory options
      generateContentFn: mockGenerateContentFn,
      generateImageFn: mockGenerateImageFn,
      waitIfPaused: mockWaitIfPaused,
    };

    // Default mock implementations
    mockGetActionHandler.mockReturnValue(mockSendMessageHandler);
    mockGenerateContentFn.mockImplementation(async (prompt: PromptItem[], args) => {
      if (
        args?.requiredFunctionName === 'conversationGraph' &&
        prompt.some((p: PromptItem) => p.type === 'user' && p.text === CONVERSATION_GRAPH_PROMPT)
      ) {
        return [{ type: 'functionCall', functionCall: defaultGraphCall }];
      }
      if (
        args?.requiredFunctionName === 'conversationGraph' &&
        prompt.some((p: PromptItem) => p.type === 'user' && p.text === GRAPH_REVISION_PROMPT_TEXT)
      ) {
        // Simulate returning the revised graph
        return [{ type: 'functionCall', functionCall: revisedGraphCall }];
      }
      if (args?.requiredFunctionName === 'evaluateEdge') {
        return [{ type: 'functionCall', functionCall: defaultEvaluateEdgeCall }];
      }
      if (args?.requiredFunctionName === 'sendMessage') {
        return [{ type: 'functionCall', functionCall: defaultSendMessageCall }];
      }
      if (prompt.some((p: PromptItem) => p.type === 'user' && p.text === GRAPH_ANALYSIS_PROMPT_TEXT)) {
        return [{ type: 'text', text: 'Graph analysis complete. No major issues found.' }];
      }
      // Default fallback or throw error if unexpected call
      // console.warn('Unexpected generateContent call:', JSON.stringify({ prompt, args }, null, 2));
      return [{ type: 'text', text: 'Default LLM response' }];
    });
  });

  afterEach(() => {
    // Verify prompts are updated correctly (optional)
    // console.log('Final prompt:', JSON.stringify(props.prompt, null, 2));
  });

  it('should terminate if user declines confirmation', async () => {
    mockAskUserForConfirmationWithAnswer.mockResolvedValue({ confirmed: false, answer: 'No thanks' });

    const result = await handleConversationGraph(props);

    expect(result).toEqual({ breakLoop: false, items: [] });
    expect(mockAskUserForConfirmationWithAnswer).toHaveBeenCalledTimes(1);
    expect(mockGenerateContentFn).not.toHaveBeenCalled();
    expect(mockPutSystemMessage).toHaveBeenCalledWith('Conversation graph declined.');
    expect(props.prompt).toEqual([
      // Check prompt state after decline
      ...initialPrompt,
      { type: 'assistant', text: 'Assistant wants to start graph' },
      { type: 'user', text: 'Declined conversation graph. \n\nNo thanks' },
    ]);
  });

  it('should handle initial graph generation failure', async () => {
    mockAskUserForConfirmationWithAnswer.mockResolvedValue({ confirmed: true });
    mockGenerateContentFn.mockImplementation(async (prompt: PromptItem[], args) => {
      if (
        args?.requiredFunctionName === 'conversationGraph' &&
        prompt.some((p: PromptItem) => p.type === 'user' && p.text === CONVERSATION_GRAPH_PROMPT)
      ) {
        return [{ type: 'text', text: 'LLM failed' }]; // Simulate failure
      }
      return [];
    });

    const result = await handleConversationGraph(props);

    expect(result).toEqual({ breakLoop: false, items: [] });
    expect(mockPutSystemMessage).toHaveBeenCalledWith('Generating conversation graph...');
    expect(mockPutSystemMessage).toHaveBeenCalledWith('Failed to generate initial conversation graph.');
    // Check the last two items pushed to the prompt
    expect(props.prompt.slice(-2)).toEqual([
      {
        type: 'assistant',
        text: 'I encountered an issue generating the conversation plan.',
      },
      {
        type: 'user',
        text: 'Okay, unable to generate graph.',
      },
    ]);
  });

  it('should execute a simple graph successfully (generation, analysis, traversal)', async () => {
    mockAskUserForConfirmationWithAnswer.mockResolvedValue({ confirmed: true, answer: 'Yes, proceed' });

    const result = await handleConversationGraph(props);

    expect(result).toEqual({ breakLoop: false, items: [] });

    // Confirmation
    expect(mockAskUserForConfirmationWithAnswer).toHaveBeenCalledTimes(1);
    expect(mockPutUserMessage).toHaveBeenCalledWith('Yes, proceed');

    // Generation
    expect(mockPutSystemMessage).toHaveBeenCalledWith('Generating conversation graph...');
    expect(mockGenerateContentFn).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ text: CONVERSATION_GRAPH_PROMPT })]),
      expect.objectContaining({ requiredFunctionName: 'conversationGraph', modelType: ModelType.DEFAULT }),
      props.options,
    );
    // Analysis Start
    expect(mockPutSystemMessage).toHaveBeenCalledWith('Starting automatic graph analysis...', expect.any(Object));

    // Analysis Call
    expect(mockGenerateContentFn).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ text: GRAPH_ANALYSIS_PROMPT_TEXT })]),
      expect.objectContaining({ modelType: ModelType.CHEAP }),
      props.options,
    );
    // Revision Attempt
    expect(mockPutSystemMessage).toHaveBeenCalledWith(
      'Attempting to fix graph based on analysis...',
      expect.any(Object),
    );
    // Revision Call
    expect(mockGenerateContentFn).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ text: GRAPH_REVISION_PROMPT_TEXT })]),
      expect.objectContaining({ requiredFunctionName: 'conversationGraph', modelType: ModelType.DEFAULT }),
      props.options,
    );
    // Revision Success
    expect(mockPutSystemMessage).toHaveBeenCalledWith('Graph revised successfully.', expect.any(Object));

    // User acceptance added to prompt
    expect(props.prompt).toContainEqual({
      type: 'user',
      text: 'I accept the conversation graph and will proceed with it.' + '\n\nYes, proceed',
      functionResponses: [
        {
          name: 'conversationGraph',
          call_id: defaultGraphCall.id, // Corrected: Expect the ID of the *initial* graph call used for execution
          content: '', // Content is empty string when accepting
        },
      ],
    });

    // Traversal Start
    expect(mockPutSystemMessage).toHaveBeenCalledWith('Starting conversation graph traversal.', expect.any(Object));

    // Node 'start' execution
    expect(mockPutSystemMessage).toHaveBeenCalledWith('Executing node start (Action: sendMessage)', expect.any(Object));
    expect(mockGenerateContentFn).toHaveBeenCalledWith(
      // For generating node message
      expect.any(Array),
      expect.objectContaining({ requiredFunctionName: 'sendMessage' }),
      props.options,
    );
    expect(mockPutAssistantMessage).toHaveBeenCalledWith('Generated message for node', expect.any(Object));
    expect(mockGetActionHandler).toHaveBeenCalledWith('sendMessage');
    expect(mockSendMessageHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        askQuestionCall: expect.objectContaining({
          args: { message: 'Generated message for node', actionType: 'sendMessage' },
        }),
      }),
    );

    // Edge Evaluation from 'start'
    expect(mockGenerateContentFn).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          text: expect.stringContaining('evaluating the outgoing edges from the current node(start)'),
        }),
      ]),
      expect.objectContaining({ requiredFunctionName: 'evaluateEdge', modelType: ModelType.CHEAP }),
      props.options,
    );

    // Node 'next' execution
    expect(mockPutSystemMessage).toHaveBeenCalledWith('Executing node next (Action: sendMessage)', expect.any(Object));
    // ... similar checks for sendMessage call, handler call ...
    expect(mockSendMessageHandler).toHaveBeenCalledTimes(2); // Called for 'start' and 'next'

    // Edge Evaluation from 'next' (no outgoing edges)
    expect(mockPutSystemMessage).toHaveBeenCalledWith(
      'No outgoing edges found from node next. Ending execution.',
      expect.any(Object),
    );

    // Completion
    expect(mockPutSystemMessage).toHaveBeenCalledWith('Conversation graph traversal completed.', expect.any(Object));
    expect(props.prompt.slice(-1)[0]).toEqual({ type: 'user', text: 'Lets continue the conversation.' });
  });

  it('should terminate traversal if edge evaluation returns shouldTerminate: true', async () => {
    mockAskUserForConfirmationWithAnswer.mockResolvedValue({ confirmed: true });
    const terminateEvaluateEdgeCall: EvaluateEdgeCall = {
      id: 'eval-term-call',
      name: 'evaluateEdge',
      args: {
        reasoning: 'User wants to stop',
        selectedEdge: null,
        shouldTerminate: true,
      },
    };
    mockGenerateContentFn.mockImplementation(async (prompt: PromptItem[], args) => {
      if (args?.requiredFunctionName === 'evaluateEdge') {
        return [{ type: 'functionCall', functionCall: terminateEvaluateEdgeCall }]; // Terminate after first node
      }
      if (
        args?.requiredFunctionName === 'conversationGraph' &&
        prompt.some((p: PromptItem) => p.type === 'user' && p.text === CONVERSATION_GRAPH_PROMPT)
      ) {
        return [{ type: 'functionCall', functionCall: defaultGraphCall }];
      }
      if (args?.requiredFunctionName === 'sendMessage') {
        return [{ type: 'functionCall', functionCall: defaultSendMessageCall }];
      }
      if (prompt.some((p: PromptItem) => p.type === 'user' && p.text === GRAPH_ANALYSIS_PROMPT_TEXT)) {
        return [{ type: 'text', text: 'Analysis done.' }];
      }
      if (
        args?.requiredFunctionName === 'conversationGraph' &&
        prompt.some((p: PromptItem) => p.type === 'user' && p.text === GRAPH_REVISION_PROMPT_TEXT)
      ) {
        // Simulate revision failure for this specific test
        return [{ type: 'text', text: 'Revision failed' }];
      }
      return [];
    });

    const result = await handleConversationGraph(props);

    expect(result).toEqual({ breakLoop: false, items: [] });
    expect(mockSendMessageHandler).toHaveBeenCalledTimes(1); // Only 'start' node executed
    expect(mockPutSystemMessage).toHaveBeenCalledWith('Executing node start (Action: sendMessage)', expect.any(Object));
    expect(mockPutSystemMessage).toHaveBeenCalledWith(
      'Failed to generate revised conversation graph, keeping original.',
      expect.any(Object),
    );
    expect(mockPutSystemMessage).toHaveBeenCalledWith(
      'Conversation graph traversal terminated by edge evaluation.',
      expect.any(Object),
    );
    expect(mockPutSystemMessage).toHaveBeenCalledWith('Conversation graph traversal completed.', expect.any(Object));
    // Check prompt includes the edge evaluation
    expect(props.prompt).toContainEqual({ type: 'assistant', functionCalls: [terminateEvaluateEdgeCall] });
    expect(props.prompt).toContainEqual({
      type: 'user',
      functionResponses: [
        {
          name: 'evaluateEdge',
          call_id: terminateEvaluateEdgeCall.id,
          content: JSON.stringify(terminateEvaluateEdgeCall.args),
        },
      ],
      text: 'Edge evaluated: Terminate',
    });
  });

  it('should terminate traversal if a node handler returns breakLoop: true', async () => {
    mockAskUserForConfirmationWithAnswer.mockResolvedValue({ confirmed: true });
    const breakLoopHandler = vi.fn().mockResolvedValue({ breakLoop: true, items: [], stepResult: [] });
    mockGetActionHandler.mockReturnValue(breakLoopHandler); // Make 'start' node break

    const result = await handleConversationGraph(props);

    expect(result).toEqual({ breakLoop: true, items: [], stepResult: [] });
    expect(mockSendMessageHandler).not.toHaveBeenCalled(); // Default handler shouldn't be called
    expect(breakLoopHandler).toHaveBeenCalledTimes(1); // Called for 'start' node
    expect(mockPutSystemMessage).toHaveBeenCalledWith('Executing node start (Action: sendMessage)', expect.any(Object));
    expect(mockPutSystemMessage).toHaveBeenCalledWith(
      'Node action sendMessage requested to break loop.',
      expect.any(Object),
    );
    // Traversal shouldn't complete normally
    expect(mockPutSystemMessage).not.toHaveBeenCalledWith(
      'Conversation graph traversal completed.',
      expect.any(Object),
    );
  });

  it('should handle errors during traversal gracefully', async () => {
    mockAskUserForConfirmationWithAnswer.mockResolvedValue({ confirmed: true });
    const errorHandler = vi.fn().mockRejectedValue(new Error('Node execution failed!'));
    mockGetActionHandler.mockReturnValue(errorHandler);

    const result = await handleConversationGraph(props);

    expect(result).toEqual({ breakLoop: false, items: [] });
    expect(errorHandler).toHaveBeenCalledTimes(1);
    expect(mockPutSystemMessage).toHaveBeenCalledWith(
      'Error during conversation graph execution',
      expect.objectContaining({
        error: expect.any(Error),
      }),
    );
    // Check that the error message was added to the prompt for the assistant
    expect(props.prompt.slice(-2)).toEqual([
      {
        type: 'assistant',
        text: 'An error occurred during conversation graph execution.',
      },
      {
        type: 'user',
        text: 'Lets continue the conversation.',
      },
    ]);
    // Should not indicate normal completion
    expect(mockPutSystemMessage).not.toHaveBeenCalledWith(
      'Conversation graph traversal completed.',
      expect.any(Object),
    );
  });

  it('should handle analysis failure and proceed with original graph', async () => {
    mockAskUserForConfirmationWithAnswer.mockResolvedValue({ confirmed: true });
    mockGenerateContentFn.mockImplementation(async (prompt: PromptItem[], args) => {
      if (
        args?.requiredFunctionName === 'conversationGraph' &&
        prompt.some((p: PromptItem) => p.type === 'user' && p.text === CONVERSATION_GRAPH_PROMPT)
      ) {
        return [{ type: 'functionCall', functionCall: defaultGraphCall }];
      }
      if (prompt.some((p: PromptItem) => p.type === 'user' && p.text === GRAPH_ANALYSIS_PROMPT_TEXT)) {
        return [{ type: 'text', text: undefined }]; // Simulate analysis failure (no text)
      }
      if (args?.requiredFunctionName === 'evaluateEdge') {
        return [{ type: 'functionCall', functionCall: defaultEvaluateEdgeCall }];
      }
      if (args?.requiredFunctionName === 'sendMessage') {
        return [{ type: 'functionCall', functionCall: defaultSendMessageCall }];
      }
      // Revision should NOT be called if analysis fails
      if (
        args?.requiredFunctionName === 'conversationGraph' &&
        prompt.some((p: PromptItem) => p.type === 'user' && p.text === GRAPH_REVISION_PROMPT_TEXT)
      ) {
        throw new Error('Revision should not be called when analysis fails');
      }
      return [];
    });

    const result = await handleConversationGraph(props);

    expect(result).toEqual({ breakLoop: false, items: [] });
    expect(mockPutSystemMessage).toHaveBeenCalledWith(
      'LLM failed to provide analysis text. Proceeding with original graph.',
      expect.any(Object),
    );
    // Ensure traversal still happens with the original graph
    expect(mockPutSystemMessage).toHaveBeenCalledWith('Starting conversation graph traversal.', expect.any(Object));
    expect(mockSendMessageHandler).toHaveBeenCalledTimes(2); // Both nodes should execute
    expect(mockPutSystemMessage).toHaveBeenCalledWith('Conversation graph traversal completed.', expect.any(Object));
  });

  it('should handle revision failure and proceed with original graph', async () => {
    mockAskUserForConfirmationWithAnswer.mockResolvedValue({ confirmed: true });
    mockGenerateContentFn.mockImplementation(async (prompt: PromptItem[], args) => {
      if (
        args?.requiredFunctionName === 'conversationGraph' &&
        prompt.some((p: PromptItem) => p.type === 'user' && p.text === CONVERSATION_GRAPH_PROMPT)
      ) {
        return [{ type: 'functionCall', functionCall: defaultGraphCall }];
      }
      if (prompt.some((p: PromptItem) => p.type === 'user' && p.text === GRAPH_ANALYSIS_PROMPT_TEXT)) {
        return [{ type: 'text', text: 'Analysis found minor issues.' }];
      }
      if (
        args?.requiredFunctionName === 'conversationGraph' &&
        prompt.some((p: PromptItem) => p.type === 'user' && p.text === GRAPH_REVISION_PROMPT_TEXT)
      ) {
        return [{ type: 'text', text: 'LLM failed revision' }]; // Simulate revision failure
      }
      if (args?.requiredFunctionName === 'evaluateEdge') {
        return [{ type: 'functionCall', functionCall: defaultEvaluateEdgeCall }];
      }
      if (args?.requiredFunctionName === 'sendMessage') {
        return [{ type: 'functionCall', functionCall: defaultSendMessageCall }];
      }
      return [];
    });

    const result = await handleConversationGraph(props);

    expect(result).toEqual({ breakLoop: false, items: [] });
    expect(mockPutSystemMessage).toHaveBeenCalledWith(
      'Attempting to fix graph based on analysis...',
      expect.any(Object),
    );
    expect(mockPutSystemMessage).toHaveBeenCalledWith(
      'Failed to generate revised conversation graph, keeping original.',
      expect.any(Object),
    );
    // Ensure traversal still happens with the original graph
    expect(mockPutSystemMessage).toHaveBeenCalledWith('Starting conversation graph traversal.', expect.any(Object));
    expect(mockSendMessageHandler).toHaveBeenCalledTimes(2); // Both nodes should execute
    expect(mockPutSystemMessage).toHaveBeenCalledWith('Conversation graph traversal completed.', expect.any(Object));
  });
});
