import { ActionHandlerProps, ActionResult, AskQuestionCall, SendMessageArgs } from '../step-ask-question-types.js';
import { putAssistantMessage, putSystemMessage, putUserMessage } from '../../../../main/common/content-bus.js';
import { FunctionCall, ModelType, PromptItem } from '../../../../ai-service/common-types.js';
import { getFunctionDefs } from '../../../function-calling.js';
import {
  ConversationEdge,
  ConversationGraphCall,
  ConversationNode,
  ConversationNodeId,
  EvaluateEdgeCall,
} from '../../../function-defs/conversation-graph.js';
import { registerActionHandler } from '../step-ask-question-handlers.js';
import { getActionHandler } from '../ask-question-handler.js';
import { askUserForConfirmationWithAnswer, ConfirmHandlerResponse } from '../../../../main/common/user-actions.js';

export const CONVERSATION_GRAPH_PROMPT = `# Conversation Graph Guide

A conversation graph is a flexible structure for managing complex interactions. It consists of nodes (conversation states) connected by edges (transitions).

## Core Components

1. **Nodes (States)**
   - Each node represents a distinct state in the conversation
   - Contains:
     - id: Unique identifier
     - actionType: The action to perform
     - instruction: Internal guidance for execution

2. **Edges (Transitions)**
   - Connect nodes to define possible conversation flows
   - Contains:
     - sourceNode: Starting point
     - targetNode: Destination
     - instruction: Condition for transition

## Key Concepts

- **State Management**: Nodes capture the current state and required action
- **Flow Control**: Edges determine how the conversation can progress
- **Flexibility**: Support for various conversation patterns and flows
- **Context Awareness**: Each node operates with awareness of the conversation state
- **User Interaction**: User can reject or accept some of the actions, so the graph should account for that

## Implementation Notes

- Nodes should be self-contained and focused
- Edges should have clear, evaluatable conditions
- Any node can connect to any other node if logically appropriate
- Nodes and edges must formulate a graph structure, allowing for complex interactions

## Graph Structure requirements and constraints

- The graph may contain cycles, but should be designed to avoid infinite loops
- Each node should be reachable from the entry node
- The entry node should be clearly defined and serve as the starting point for the conversation

## Technical Details

Nodes require:
- Unique ID for reference
- Valid action type
- Clear execution instructions

Edges require:
- Valid source and target node IDs
- Clear transition conditions

# Let's get started!

0. Read and understand the conersation we had so far (context).
1. Think about the big picture of the upcoming conversation flow and the desired outcome.
2. Define the entry node to start the upcoming conversation.
3. Create nodes with reasoning, action type, and instructions.
4. Connect nodes with edges to define the conversation flow.
`;

export const getEdgeEvaluationPrompt = (currentNode: ConversationNode, outgoingEdges: ConversationEdge[]) => {
  return `We are evaluating the outgoing edges from the current node(${currentNode.id}):

${outgoingEdges.map((edge) => `- ${edge.targetNode}: ${edge.instruction}`).join('\n')}

Select the correct edge, or terminate if the conversation should stop. Use the 'evaluateEdge' function.`;
};

export const GRAPH_ANALYSIS_PROMPT_TEXT = `Please analyze the conversation graph provided by the assistant in the preceding message. Simulate diverse conversation paths mentally and identify any structural or logical problems, dead ends, unreachable nodes, missing transitions, or potential infinite loops. Explain the problems you find in detail. If no significant problems are found, state that clearly.`;

export const GRAPH_REVISION_PROMPT_TEXT = `Based on the analysis provided in the preceding message, generate a new, improved conversation graph using the 'conversationGraph' function. Ensure the new graph addresses the identified problems and better facilitates the original conversation goal.`;

type ConversationGraphState = {
  nodes: ConversationNode[];
  edges: ConversationEdge[];
  currentNodeId: string | null;
  isActive: boolean;
};

// Internal type for managing state within the handler
type GraphHandlingState = {
  prompt: PromptItem[];
  currentGraphState: ConversationGraphState | null;
  conversationGraphCall: ConversationGraphCall | null;
};

registerActionHandler('conversationGraph', handleConversationGraph);

/**
 * Main handler for the conversationGraph action.
 * Orchestrates confirmation, generation, analysis/revision, and traversal.
 */
export async function handleConversationGraph(props: ActionHandlerProps): Promise<ActionResult> {
  const state: GraphHandlingState = {
    prompt: [...props.prompt], // Work on a copy
    currentGraphState: null,
    conversationGraphCall: null,
  };

  try {
    // 1. Confirm Execution
    const userConfirmation = await _confirmGraphExecution(props.askQuestionCall, state, props.options);
    if (!userConfirmation.confirmed) {
      props.prompt.push(...state.prompt.slice(props.prompt.length)); // Update original prompt if declined
      return { breakLoop: false, items: [] };
    }

    // 2. Generate Initial Graph
    const initialGraphCall = await _generateInitialGraph(
      props.askQuestionCall,
      state,
      props.generateContentFn,
      props.options,
    );
    if (!initialGraphCall) {
      props.prompt.push(...state.prompt.slice(props.prompt.length)); // Update original prompt on failure
      return { breakLoop: false, items: [] };
    }

    // 3. Analyze and Revise Graph
    const finalGraphCall = await _analyzeAndReviseGraph(state, props.generateContentFn, props.options);
    if (!finalGraphCall) {
      // This case implies the initial generation failed, handled in _generateInitialGraph
      // If analysis/revision failed, we still proceed with the initial graph (returned by _analyzeAndReviseGraph)
      // So, if finalGraphCall is null here, something went very wrong earlier.
      throw new Error('Unexpected state: finalGraphCall is null after analysis/revision.');
    }
    state.conversationGraphCall = finalGraphCall; // Ensure state uses the final graph

    // 4. Traverse Graph
    const traversalResult = await _traverseGraph(state, props, userConfirmation);

    // Update the original prompt with the full history from the graph execution
    props.prompt.splice(0, props.prompt.length, ...state.prompt);

    return traversalResult;
  } catch (error) {
    // Ensure final state is marked inactive on error
    if (state.currentGraphState) {
      state.currentGraphState = { ...state.currentGraphState, isActive: false };
    }
    putSystemMessage('Error during conversation graph execution', {
      error,
      conversationGraphState: state.currentGraphState,
    });

    // Add error context to the prompt
    state.prompt.push(
      {
        type: 'assistant',
        text: 'An error occurred during conversation graph execution.',
      },
      {
        type: 'user',
        text: 'Lets continue the conversation.',
      },
    );

    // Update the original prompt with the history including the error
    props.prompt.splice(0, props.prompt.length, ...state.prompt);

    return { breakLoop: false, items: [] };
  }
}

// Helper: Confirm Graph Execution with User
async function _confirmGraphExecution(
  askQuestionCall: AskQuestionCall,
  state: GraphHandlingState,
  options: ActionHandlerProps['options'],
) {
  const userConfirmation = await askUserForConfirmationWithAnswer(
    'The assistant wants to perform a conversation graph. Do you want to proceed?',
    'Run conversation graph',
    'Decline',
    true,
    options,
  );

  if (userConfirmation.answer) {
    putUserMessage(userConfirmation.answer);
  }

  if (!userConfirmation.confirmed) {
    putSystemMessage('Conversation graph declined.');
    state.prompt.push(
      {
        type: 'assistant',
        text: askQuestionCall.args?.message ?? '',
      },
      {
        type: 'user',
        text: 'Declined conversation graph. ' + (userConfirmation.answer ? `\n\n${userConfirmation.answer}` : ''),
      },
    );
  }

  return userConfirmation;
}

// Helper: Generate Initial Conversation Graph
async function _generateInitialGraph(
  askQuestionCall: AskQuestionCall,
  state: GraphHandlingState,
  generateContentFn: ActionHandlerProps['generateContentFn'],
  options: ActionHandlerProps['options'],
): Promise<ConversationGraphCall | null> {
  putSystemMessage('Generating conversation graph...');
  const initialGraphResponse = await generateContentFn(
    [
      ...state.prompt,
      {
        type: 'assistant',
        text: askQuestionCall.args?.message ?? '',
      },
      {
        type: 'user',
        text: CONVERSATION_GRAPH_PROMPT,
      },
    ],
    {
      functionDefs: getFunctionDefs(),
      requiredFunctionName: 'conversationGraph',
      temperature: 0.7,
      modelType: ModelType.DEFAULT,
      expectedResponseType: {
        text: false,
        functionCall: true,
        media: false,
      },
    },
    options,
  );

  const conversationGraphCall = initialGraphResponse
    .filter((item) => item.type === 'functionCall')
    .map((item) => item.functionCall)[0] as ConversationGraphCall | undefined;

  if (!conversationGraphCall || !conversationGraphCall.args) {
    putSystemMessage('Failed to generate initial conversation graph.');
    state.prompt.push(
      {
        type: 'assistant',
        text: 'I encountered an issue generating the conversation plan.',
      },
      {
        type: 'user',
        text: 'Okay, unable to generate graph.',
      },
    );
    return null;
  }

  state.prompt.push({
    type: 'assistant',
    text: askQuestionCall.args?.message ?? '',
    functionCalls: [conversationGraphCall],
  });

  state.conversationGraphCall = conversationGraphCall;
  state.currentGraphState = {
    nodes: conversationGraphCall.args.nodes,
    edges: conversationGraphCall.args.edges,
    currentNodeId: null,
    isActive: false,
  };

  return conversationGraphCall;
}

// Helper: Analyze and Revise Graph
async function _analyzeAndReviseGraph(
  state: GraphHandlingState,
  generateContentFn: ActionHandlerProps['generateContentFn'],
  options: ActionHandlerProps['options'],
): Promise<ConversationGraphCall | null> {
  if (!state.conversationGraphCall || !state.currentGraphState) {
    return null; // Should not happen if called correctly
  }

  const initialGraphCall = state.conversationGraphCall;

  putSystemMessage('Starting automatic graph analysis...', {
    conversationGraphState: state.currentGraphState,
    ...initialGraphCall.args,
  });

  const analysisPrompt: PromptItem[] = [
    {
      type: 'assistant',
      text: CONVERSATION_GRAPH_PROMPT,
    },
    {
      type: 'assistant',
      text: 'I have prepared a conversation graph for you.',
      functionCalls: [initialGraphCall],
    },
    {
      type: 'user',
      text: GRAPH_ANALYSIS_PROMPT_TEXT,
      functionResponses: [
        {
          name: 'conversationGraph',
          call_id: initialGraphCall.id,
          content: '',
        },
      ],
    },
  ];

  const analysisResult = await generateContentFn(
    analysisPrompt,
    {
      modelType: ModelType.CHEAP,
      temperature: 0.5,
      expectedResponseType: { text: true, functionCall: false, media: false },
    },
    options,
  );

  const analysisText = analysisResult.find((part) => part.type === 'text')?.text;

  if (analysisText) {
    analysisPrompt.push({ type: 'assistant', text: analysisText });

    putSystemMessage('Attempting to fix graph based on analysis...', {
      conversationGraphState: state.currentGraphState,
      analysisText,
    });

    const revisionPrompt: PromptItem[] = [
      ...analysisPrompt,
      {
        type: 'user',
        text: GRAPH_REVISION_PROMPT_TEXT,
      },
    ];

    const revisionResult = await generateContentFn(
      revisionPrompt,
      {
        modelType: ModelType.DEFAULT,
        temperature: 0.7,
        functionDefs: getFunctionDefs(),
        requiredFunctionName: 'conversationGraph',
        expectedResponseType: {
          text: false,
          functionCall: true,
          media: false,
        },
      },
      options,
    );

    const revisedGraphCall = revisionResult
      .filter((item) => item.type === 'functionCall')
      .map((item) => item.functionCall)[0] as ConversationGraphCall | undefined;

    if (revisedGraphCall?.args?.nodes?.length) {
      state.conversationGraphCall = {
        ...initialGraphCall,
        args: { ...initialGraphCall.args, ...revisedGraphCall.args },
      };
      state.currentGraphState = {
        ...state.currentGraphState,
        nodes: state.conversationGraphCall.args!.nodes,
        edges: state.conversationGraphCall.args!.edges,
      };
      putSystemMessage('Graph revised successfully.', {
        conversationGraphState: state.currentGraphState,
        ...state.conversationGraphCall.args,
      });
      return state.conversationGraphCall;
    } else {
      putSystemMessage('Failed to generate revised conversation graph, keeping original.', {
        conversationGraphState: state.currentGraphState,
      });
    }
  } else {
    putSystemMessage('LLM failed to provide analysis text. Proceeding with original graph.', {
      conversationGraphState: state.currentGraphState,
    });
  }

  return initialGraphCall; // Return original if revision failed or wasn't needed
}

// Helper: Execute Node Action
async function _executeNodeAction(
  currentNode: ConversationNode,
  state: GraphHandlingState,
  props: ActionHandlerProps,
): Promise<ActionResult> {
  const nodeAskQuestionCall: AskQuestionCall = {
    name: 'askQuestion',
    args: {
      message: currentNode.instruction, // Use node instruction as message hint
      actionType: currentNode.actionType,
    },
  };

  putSystemMessage(`Executing node ${currentNode.id} (Action: ${currentNode.actionType})`, {
    conversationGraphState: state.currentGraphState,
    nodeDetails: currentNode,
  });

  // Generate a message for the assistant to say before executing the action
  const [sendMessage] = (
    await props.generateContentFn(
      state.prompt,
      {
        functionDefs: getFunctionDefs(),
        requiredFunctionName: 'sendMessage',
        temperature: 0.7,
        modelType: ModelType.CHEAP,
        expectedResponseType: {
          text: false,
          functionCall: true,
          media: false,
        },
      },
      props.options,
    )
  )
    .filter((item) => item.type === 'functionCall')
    .map((item) => item.functionCall) as [FunctionCall<SendMessageArgs>];

  if (sendMessage?.args?.message) {
    putAssistantMessage(sendMessage.args.message, sendMessage.args);
    nodeAskQuestionCall.args!.message = sendMessage.args.message;
  }

  const currentNodeHandler = getActionHandler(currentNode.actionType);
  const nodeResult = await currentNodeHandler({
    ...props,
    askQuestionCall: nodeAskQuestionCall,
    prompt: state.prompt, // Pass the current prompt state
  });

  // Add results from the node handler to history
  if (nodeResult.items && nodeResult.items.length > 0) {
    for (const item of nodeResult.items) {
      if (item?.assistant) {
        state.prompt.push(item.assistant);
      }
      if (item?.user) {
        putUserMessage(item.user.text ?? '', item.user.data, undefined, item.user.images, item.user);
        state.prompt.push(item.user);
      }
    }
  }

  return nodeResult;
}

// Helper: Evaluate Next Step (Edges)
async function _evaluateNextStep(
  currentNode: ConversationNode,
  state: GraphHandlingState,
  generateContentFn: ActionHandlerProps['generateContentFn'],
  options: ActionHandlerProps['options'],
): Promise<{ nextNode: ConversationNode | null; terminate: boolean }> {
  const outgoingEdges = state.currentGraphState!.edges.filter((edge) => edge.sourceNode === currentNode.id);
  if (outgoingEdges.length === 0) {
    putSystemMessage(`No outgoing edges found from node ${currentNode.id}. Ending execution.`, {
      conversationGraphState: { ...state.currentGraphState!, isActive: false },
    });
    return { nextNode: null, terminate: true };
  }

  const edgeEvaluationResult = await generateContentFn(
    [
      ...state.prompt,
      {
        type: 'user',
        text: getEdgeEvaluationPrompt(currentNode, outgoingEdges),
      },
    ],
    {
      functionDefs: getFunctionDefs(),
      requiredFunctionName: 'evaluateEdge',
      temperature: 0.2,
      modelType: ModelType.CHEAP,
      expectedResponseType: {
        text: false,
        functionCall: true,
        media: false,
      },
    },
    options,
  );

  const evaluateEdge = edgeEvaluationResult
    .filter((item) => item.type === 'functionCall')
    .map((item) => item.functionCall)[0] as EvaluateEdgeCall | undefined;

  if (!evaluateEdge?.args) {
    putSystemMessage(`Failed to evaluate edges from node ${currentNode.id}. Ending execution.`, {
      conversationGraphState: { ...state.currentGraphState!, isActive: false },
    });
    return { nextNode: null, terminate: true };
  }

  state.prompt.push({ type: 'assistant', functionCalls: [evaluateEdge] });
  state.prompt.push({
    type: 'user',
    functionResponses: [
      {
        name: 'evaluateEdge',
        call_id: evaluateEdge.id,
        content: JSON.stringify(evaluateEdge.args),
      },
    ],
    text: `Edge evaluated: ${evaluateEdge.args.shouldTerminate ? 'Terminate' : (evaluateEdge.args.selectedEdge?.targetNode ?? 'Error')}`,
  });

  if (evaluateEdge.args.shouldTerminate || !evaluateEdge.args.selectedEdge) {
    putSystemMessage('Conversation graph traversal terminated by edge evaluation.', {
      conversationGraphState: { ...state.currentGraphState!, isActive: false },
    });
    return { nextNode: null, terminate: true };
  }

  const nextNodeId = evaluateEdge.args.selectedEdge.targetNode;
  const nextNode = state.currentGraphState!.nodes.find((node) => node.id === nextNodeId);

  if (!nextNode) {
    putSystemMessage(`Target node ${nextNodeId} not found. Ending execution.`, {
      conversationGraphState: { ...state.currentGraphState!, isActive: false, currentNodeId: null },
    });
    return { nextNode: null, terminate: true };
  }

  return { nextNode, terminate: false };
}

// Helper: Traverse the Graph
async function _traverseGraph(
  state: GraphHandlingState,
  props: ActionHandlerProps,
  userConfirmation: ConfirmHandlerResponse,
): Promise<ActionResult> {
  if (!state.conversationGraphCall?.args || !state.currentGraphState) {
    throw new Error('Cannot traverse graph without a valid graph definition.');
  }

  const { entryNode, nodes } = state.conversationGraphCall.args;
  let currentNode: ConversationNode | undefined | null = nodes.find((node) => node.id === entryNode);

  if (!currentNode) {
    state.currentGraphState = { ...state.currentGraphState, isActive: false, currentNodeId: null };
    putSystemMessage('Error occurred during conversation graph execution (entry node not found).', {
      conversationGraphState: state.currentGraphState,
    });
    state.prompt.push({
      type: 'user',
      text: 'Okay, unable to start graph execution (entry node not found).',
      functionResponses: [
        {
          name: 'conversationGraph',
          call_id: state.conversationGraphCall.id,
          content: '',
        },
      ],
    });
    return { breakLoop: false, items: [] };
  }

  state.currentGraphState = { ...state.currentGraphState, currentNodeId: currentNode.id, isActive: true };
  putSystemMessage('Starting conversation graph traversal.', {
    conversationGraphState: state.currentGraphState,
    entryNode,
    nodes,
    edges: state.currentGraphState.edges,
  });

  // Add prompt to history about user accepting the graph
  state.prompt.push({
    type: 'user',
    text:
      'I accept the conversation graph and will proceed with it.' +
      (userConfirmation.answer ? `\n\n${userConfirmation.answer}` : ''), // Assuming confirmation happened before
    functionResponses: [
      {
        name: 'conversationGraph',
        call_id: state.conversationGraphCall.id,
        content: '',
      },
    ],
  });

  const visitedNodes = new Set<ConversationNodeId>();
  let iteration = 0;
  const MAX_ITERATIONS = 50;

  while (currentNode && iteration < MAX_ITERATIONS) {
    iteration++;
    visitedNodes.add(currentNode.id);

    state.currentGraphState = { ...state.currentGraphState, currentNodeId: currentNode.id, isActive: true };

    const nodeResult = await _executeNodeAction(currentNode, state, props);

    if (nodeResult.breakLoop) {
      state.currentGraphState = { ...state.currentGraphState, isActive: false };
      putSystemMessage(`Node action ${currentNode.actionType} requested to break loop.`, {
        conversationGraphState: state.currentGraphState,
      });
      return nodeResult; // Propagate breakLoop
    }

    const { nextNode, terminate } = await _evaluateNextStep(currentNode, state, props.generateContentFn, props.options);

    if (terminate) {
      break;
    }

    currentNode = nextNode;
    // Update state for the next iteration (will be sent at the start of the next loop)
    if (currentNode) {
      state.currentGraphState = { ...state.currentGraphState, currentNodeId: currentNode.id };
    }
  }

  if (iteration >= MAX_ITERATIONS) {
    putSystemMessage('Maximum iterations reached. Stopping traversal.', {
      conversationGraphState: { ...state.currentGraphState!, isActive: false },
    });
  }

  state.currentGraphState = { ...state.currentGraphState!, isActive: false };
  putSystemMessage('Conversation graph traversal completed.', {
    conversationGraphState: state.currentGraphState,
  });

  state.prompt.push(
    {
      type: 'assistant',
      text: 'Conversation graph traversal completed.',
    },
    {
      type: 'user',
      text: 'Lets continue the conversation.',
    },
  );

  return { breakLoop: false, items: [] };
}
