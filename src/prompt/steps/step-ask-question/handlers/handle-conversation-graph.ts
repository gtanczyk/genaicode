import { ActionHandlerProps, ActionResult, AskQuestionCall, SendMessageArgs } from '../step-ask-question-types.js';
import { putAssistantMessage, putSystemMessage, putUserMessage } from '../../../../main/common/content-bus.js';
import { FunctionCall, ModelType, PromptItem } from '../../../../ai-service/common-types.js';
import { getFunctionDefs } from '../../../function-calling.js';
import {
  ConversationEdge,
  ConversationGraphCall,
  ConversationNode,
  EvaluateEdgeArgs,
} from '../../../function-defs/conversation-graph.js';
import { registerActionHandler } from '../step-ask-question-handlers.js';
import { getActionHandler } from '../ask-question-handler.js';
import { askUserForConfirmationWithAnswer } from '../../../../main/common/user-actions.js';
import { ConversationGraphState } from '../../../../main/ui/common/api-types.js';

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

registerActionHandler('conversationGraph', handleConversationGraph);

/**
 * Handles the conversationGraph action by:
 * 1. Generating an initial conversation graph.
 * 2. Automatically analyzing the graph once for problems using the LLM.
 * 3. Automatically attempting to fix identified problems once using the LLM.
 * 4. Executing the final version of the graph (original or revised).
 * 5. Returning appropriate ActionResult.
 */
export async function handleConversationGraph({
  askQuestionCall,
  prompt,
  options,
  generateContentFn,
  generateImageFn,
  waitIfPaused,
}: ActionHandlerProps): Promise<ActionResult> {
  let currentGraphState: ConversationGraphState | null = null;

  try {
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

      prompt.push(
        {
          type: 'assistant',
          text: askQuestionCall.args?.message ?? '',
        },
        {
          type: 'user',
          text: 'Declined conversation graph. ' + (userConfirmation.answer ? `\n\n${userConfirmation.answer}` : ''),
        },
      );

      return {
        breakLoop: false,
        items: [],
      };
    }

    putSystemMessage('Generating conversation graph...');

    // 1. Initial Graph Generation
    const initialGraphResponse = await generateContentFn(
      [
        ...prompt,
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
      prompt.push(
        {
          type: 'assistant',
          text: 'I encountered an issue generating the conversation plan.',
        },
        {
          type: 'user',
          text: 'Okay, unable to generate graph.',
        },
      );
      return {
        breakLoop: false,
        items: [],
      };
    }

    prompt.push({
      type: 'assistant',
      text: askQuestionCall.args?.message ?? '',
      functionCalls: [conversationGraphCall],
    });

    // Initialize graph state after successful generation
    currentGraphState = {
      nodes: conversationGraphCall.args.nodes,
      edges: conversationGraphCall.args.edges,
      currentNodeId: null, // Not started yet
      isActive: false,
    };

    // 2. Automatic Single Test-Fix Attempt
    putSystemMessage('Starting automatic graph analysis...', {
      conversationGraphState: currentGraphState, // Send initial state
      // ...original data...
      ...conversationGraphCall.args,
    });

    // 3. Automatic Analysis Step
    const analysisPrompt: PromptItem[] = [
      {
        type: 'assistant',
        text: CONVERSATION_GRAPH_PROMPT,
      },
      {
        type: 'assistant',
        text: 'I have prepared a conversation graph for you.',
        functionCalls: [conversationGraphCall],
      },
      {
        type: 'user',
        text: GRAPH_ANALYSIS_PROMPT_TEXT,
        functionResponses: [
          {
            name: 'conversationGraph',
            call_id: conversationGraphCall.id,
            content: '',
          },
        ],
      },
    ];

    const analysisResult = await generateContentFn(
      analysisPrompt,
      {
        modelType: ModelType.CHEAP, // Analysis can use a cheaper model
        temperature: 0.5, // Lower temp for more focused analysis
        expectedResponseType: { text: true, functionCall: false, media: false },
      },
      options,
    );

    const analysisText = analysisResult.find((part) => part.type === 'text')?.text;

    if (analysisText) {
      // Add analysis to history
      analysisPrompt.push({ type: 'assistant', text: analysisText });

      // 5. Automatic Revision Step
      putSystemMessage('Attempting to fix graph based on analysis...', {
        conversationGraphState: currentGraphState, // Send current state
        analysisText,
      });
      const revisionPrompt: PromptItem[] = [
        ...analysisPrompt, // History includes graph, analysis
        {
          type: 'user',
          text: GRAPH_REVISION_PROMPT_TEXT,
        },
      ];

      const revisionResult = await generateContentFn(
        revisionPrompt,
        {
          modelType: ModelType.DEFAULT, // Revision needs quality
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
        // 6. Graph Update and Validation (Basic)
        conversationGraphCall.args = Object.assign({}, conversationGraphCall.args, revisedGraphCall.args); // Merge args
        // Update graph state with revised nodes/edges
        currentGraphState = {
          ...currentGraphState,
          nodes: conversationGraphCall.args.nodes,
          edges: conversationGraphCall.args.edges,
        };
        putSystemMessage('Graph revised successfully.', {
          conversationGraphState: currentGraphState, // Send revised state
          ...conversationGraphCall.args,
        });
      } else {
        putSystemMessage('Failed to generate revised conversation graph, keeping original.', {
          conversationGraphState: currentGraphState, // Send original state
        });
      }
    } else {
      putSystemMessage('LLM failed to provide analysis text. Proceeding with original graph.', {
        conversationGraphState: currentGraphState, // Send current state
      });
    }

    // --- End of Test-Fix Attempt ---

    const graphToExecute = conversationGraphCall; // Use the final version of the graph
    const { entryNode, nodes, edges } = graphToExecute.args!;

    // Update state before starting traversal
    currentGraphState = {
      nodes,
      edges,
      currentNodeId: entryNode,
      isActive: true,
    };

    putSystemMessage('Starting conversation graph traversal.', {
      conversationGraphState: currentGraphState, // Send state at start
      entryNode,
      nodes,
      edges,
    });

    // Start with the first node
    let currentNode = nodes.find((node) => node.id === entryNode)!;

    if (!currentNode) {
      currentGraphState = { ...currentGraphState, isActive: false, currentNodeId: null };
      putSystemMessage('Error occurred during conversation graph execution (entry node not found).', {
        conversationGraphState: currentGraphState,
      });
      prompt.push({
        type: 'user',
        text: 'Okay, unable to start graph execution (entry node not found).',
        functionResponses: [
          {
            name: 'conversationGraph',
            call_id: conversationGraphCall.id,
            content: '',
          },
        ],
      });
      return {
        breakLoop: false,
        items: [],
      };
    }

    // Add prompt to history about user accepting the graph
    prompt.push({
      type: 'user',
      text:
        'I accept the conversation graph and will proceed with it.' +
        (userConfirmation.answer
          ? `\
\
${userConfirmation.answer}`
          : ''),
      functionResponses: [
        {
          name: 'conversationGraph',
          call_id: conversationGraphCall.id,
          content: '',
        },
      ],
    });

    // Track visited nodes to prevent cycles
    const visitedNodes = new Set<string>();
    let iteration = 0;
    const MAX_ITERATIONS = 50; // Safeguard against infinite loops

    while (currentNode && iteration < MAX_ITERATIONS) {
      iteration++;
      visitedNodes.add(currentNode.id);

      // Update state before executing node
      currentGraphState = { ...currentGraphState, currentNodeId: currentNode.id, isActive: true };

      // Execute the current node
      const nodeAskQuestionCall: AskQuestionCall = {
        name: 'askQuestion',
        args: {
          message: currentNode.instruction, // Use node instruction as message hint
          actionType: currentNode.actionType,
        },
      };

      // Inform user about the action
      putSystemMessage(`Executing node ${currentNode.id} (Action: ${currentNode.actionType})`, {
        conversationGraphState: currentGraphState,
        nodeDetails: currentNode,
      });

      const [sendMessage] = (
        await generateContentFn(
          prompt,
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
          options,
        )
      )
        .filter((item) => item.type === 'functionCall')
        .map((item) => item.functionCall) as [FunctionCall<SendMessageArgs>];

      if (sendMessage?.args?.message) {
        putAssistantMessage(sendMessage.args.message, sendMessage.args);
        nodeAskQuestionCall.args!.message = sendMessage.args.message;
      }

      // 1. Get the correct handler for the node's action type
      const currentNodeHandler = getActionHandler(currentNode.actionType);

      // 3. Call the handler with the constructed context
      const nodeResult = await currentNodeHandler({
        askQuestionCall: nodeAskQuestionCall,
        prompt,
        options,
        generateContentFn,
        generateImageFn,
        waitIfPaused,
      });

      // Add results to history
      // Iterate through *all* items returned by the handler
      if (nodeResult.items && nodeResult.items.length > 0) {
        for (const item of nodeResult.items) {
          if (item?.assistant) {
            prompt.push(item.assistant);
          }
          if (item?.user) {
            // Use putUserMessage to ensure it's displayed in the UI correctly
            putUserMessage(item.user.text ?? '', item.user.data, undefined, item.user.images, item.user);
            prompt.push(item.user); // Add to internal history for LLM context
          }
        }
      }

      if (nodeResult.breakLoop) {
        currentGraphState = { ...currentGraphState, isActive: false };
        putSystemMessage(`Node action ${currentNode.actionType} requested to break loop.`, {
          conversationGraphState: currentGraphState,
        });
        return { breakLoop: true, stepResult: nodeResult.stepResult, items: nodeResult.items };
      }

      // Determine next node
      const outgoingEdges = edges.filter((edge) => edge.sourceNode === currentNode.id);
      if (outgoingEdges.length === 0) {
        currentGraphState = { ...currentGraphState, isActive: false };
        putSystemMessage(`No outgoing edges found from node ${currentNode.id}. Ending execution.`, {
          conversationGraphState: currentGraphState,
        });
        break;
      }

      const edgeEvaluationResult = await generateContentFn(
        [
          ...prompt,
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
        .map((item) => item.functionCall)[0] as FunctionCall<EvaluateEdgeArgs> | undefined;

      if (!evaluateEdge?.args) {
        currentGraphState = { ...currentGraphState, isActive: false };
        putSystemMessage(`Failed to evaluate edges from node ${currentNode.id}. Ending execution.`, {
          conversationGraphState: currentGraphState,
        });
        break;
      }

      // Add edge evaluation to history
      prompt.push({ type: 'assistant', functionCalls: [evaluateEdge] });
      prompt.push({
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
        currentGraphState = { ...currentGraphState, isActive: false };
        putSystemMessage('Conversation graph traversal terminated by edge evaluation.', {
          conversationGraphState: currentGraphState,
        });
        break;
      }

      const nextNodeId = evaluateEdge.args.selectedEdge.targetNode;
      const nextNode = nodes.find((node) => node.id === nextNodeId);

      if (!nextNode) {
        currentGraphState = { ...currentGraphState, isActive: false, currentNodeId: null };
        putSystemMessage(`Target node ${nextNodeId} not found. Ending execution.`, {
          conversationGraphState: currentGraphState,
        });
        break;
      }

      // TODO: Add explicit cycle detection check here:
      // if (visitedNodes.has(nextNode.id)) { ... break; }

      currentNode = nextNode;
      // Update state for the next iteration (will be sent at the start of the next loop)
      currentGraphState = { ...currentGraphState, currentNodeId: nextNode.id };
    }

    if (iteration >= MAX_ITERATIONS) {
      currentGraphState = {
        ...(currentGraphState ?? { nodes: [], edges: [], currentNodeId: null, isActive: false }),
        isActive: false,
      };
      putSystemMessage('Maximum iterations reached. Stopping traversal.', {
        conversationGraphState: currentGraphState,
      });
    }

    // Ensure final state is marked inactive
    currentGraphState = {
      ...(currentGraphState ?? { nodes: [], edges: [], currentNodeId: null, isActive: false }),
      isActive: false,
    };
    putSystemMessage('Conversation graph traversal completed.', {
      conversationGraphState: currentGraphState,
    });

    prompt.push(
      {
        type: 'assistant',
        text: 'Conversation graph traversal completed.',
      },
      {
        type: 'user',
        text: 'Lets continue the conversation.',
      },
    );

    return {
      breakLoop: false,
      items: [],
    };
  } catch (error) {
    // Ensure final state is marked inactive on error
    currentGraphState = {
      ...(currentGraphState ?? { nodes: [], edges: [], currentNodeId: null, isActive: false }),
      isActive: false,
    };
    putSystemMessage('Error during conversation graph execution', {
      error,
      conversationGraphState: currentGraphState,
    });

    prompt.push(
      {
        type: 'assistant',
        text: 'An error occurred during conversation graph execution.', // TODO: Prompt user for message
      },
      {
        type: 'user',
        text: 'Lets continue the conversation.', // TODO: Prompt user for message
      },
    );

    return {
      breakLoop: false,
      items: [],
    };
  }
}
