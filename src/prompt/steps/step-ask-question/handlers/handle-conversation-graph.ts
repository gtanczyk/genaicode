import { ActionHandlerProps, ActionResult, SendMessageArgs } from '../step-ask-question-types.js';
import { putAssistantMessage, putSystemMessage, putUserMessage } from '../../../../main/common/content-bus.js';
import { FunctionCall, ModelType } from '../../../../ai-service/common-types.js';
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

## Implementation Notes

- Nodes should be self-contained and focused
- Edges should have clear, evaluatable conditions
- Any node can connect to any other node if logically appropriate
- Nodes and edges must formulate a direct acyclic graph (DAG)

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
  
Select the correct edge, or terminate if the conversation should stop.`;
};

registerActionHandler('conversationGraph', handleConversationGraph);

/**
 * Handles the conversationGraph action by:
 * 1. Generating a conversationGraph function call
 * 2. Extracting nodes and edges from the response
 * 3. Traversing the graph and executing actions
 * 4. Returning appropriate ActionResult
 */
export async function handleConversationGraph({
  askQuestionCall,
  prompt,
  options,
  generateContentFn,
  generateImageFn,
  waitIfPaused,
}: ActionHandlerProps): Promise<ActionResult> {
  try {
    const userConfirmation = await askUserForConfirmationWithAnswer(
      'The assistant wants to perform a conversation graph. Do you want to proceed?',
      'Run conversation graph',
      'Decline',
      true,
      options,
    );

    if (!userConfirmation.confirmed) {
      putSystemMessage('Conversation graph declined.');

      return {
        breakLoop: false,
        items: [
          {
            assistant: {
              type: 'assistant',
              text: askQuestionCall.args?.message ?? '',
            },
            user: {
              type: 'user',
              text: 'Declined conversation graph. ' + userConfirmation.answer,
            },
          },
        ],
      };
    }

    putSystemMessage('Generating conversation graph...');

    // Generate the conversationGraph function call
    const [conversationGraphCall] = (await generateContentFn(
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
      getFunctionDefs(),
      'conversationGraph',
      0.7,
      ModelType.DEFAULT,
      options,
    )) as [ConversationGraphCall];

    prompt.push(
      {
        type: 'assistant',
        text: askQuestionCall.args?.message ?? '',
        functionCalls: [conversationGraphCall],
      },
      {
        type: 'user',
        functionResponses: [
          {
            name: 'conversationGraph',
            call_id: conversationGraphCall.id,
            content: '',
          },
        ],
      },
    );

    const { entryNode, nodes, edges } = conversationGraphCall.args!;

    putSystemMessage('Starting conversation graph traversal.', {
      entryNode,
      nodes,
      edges,
    });

    // Start with the first node
    let currentNode = nodes.find((node) => node.id === entryNode)!;

    if (!currentNode) {
      return {
        breakLoop: false,
        items: [
          {
            assistant: {
              type: 'assistant',
              text: askQuestionCall.args?.message ?? '',
            },
            user: {
              type: 'user',
              text: 'Error occurred during conversation graph execution.',
            },
          },
        ],
      };
    }

    // Track visited nodes to prevent cycles
    const visitedNodes = new Set<string>();
    let iteration = 0;
    const MAX_ITERATIONS = 50; // Safeguard against infinite loops

    while (currentNode && iteration < MAX_ITERATIONS) {
      iteration++;
      visitedNodes.add(currentNode.id);

      // Execute the current node

      putSystemMessage(`Executing node ${currentNode.id}`, currentNode);

      const [sendMessage] = (await generateContentFn(
        prompt,
        getFunctionDefs(),
        'sendMessage',
        0.7,
        ModelType.CHEAP,
        options,
      )) as [FunctionCall<SendMessageArgs>];

      if (sendMessage.args?.message) {
        putAssistantMessage(sendMessage.args.message, sendMessage.args);
      }

      const currentNodeHandler = getActionHandler(currentNode.actionType);
      const nodeResult = await currentNodeHandler({
        askQuestionCall: {
          name: 'askQuestion',
          args: {
            message: sendMessage.args?.message ?? '',
            actionType: currentNode.actionType,
          },
        },
        prompt,
        options,
        generateContentFn,
        generateImageFn,
        waitIfPaused,
      });

      const lastItem = nodeResult.items.slice(-1)[0];
      if (lastItem?.user?.text) {
        putUserMessage(lastItem.user.text, undefined, undefined, undefined, lastItem.user);
      }

      prompt.push(...nodeResult.items.map(({ assistant, user }) => [assistant, user]).flat());

      // Move to the next node

      const outgoingEdges = edges.filter((edge) => edge.sourceNode === currentNode.id);

      const [evaluateEdge] = (await generateContentFn(
        [
          ...prompt,
          {
            type: 'user',
            text: getEdgeEvaluationPrompt(currentNode, outgoingEdges),
          },
        ],
        getFunctionDefs(),
        'evaluateEdge',
        0.7,
        ModelType.CHEAP,
        options,
      )) as [FunctionCall<EvaluateEdgeArgs>];

      if (!evaluateEdge.args?.shouldTerminate) {
        putSystemMessage('Conversation graph traversal terminated.');
        break;
      }

      const outgoingEdge = outgoingEdges.find(
        (edge) => edge.targetNode === evaluateEdge.args?.selectedEdge?.targetNode,
      );

      if (!outgoingEdge) {
        putSystemMessage(`No valid outgoing edge found from node ${currentNode.id}.`);
        break;
      }

      // Find next node
      const nextNode = nodes.find((node) => node.id === outgoingEdge.targetNode);
      if (!nextNode) {
        putSystemMessage(`Target node ${outgoingEdge.targetNode} not found.`);
        break;
      }

      // Check for cycles
      if (visitedNodes.has(nextNode.id)) {
        putSystemMessage(`Cycle detected at node ${nextNode.id}. Stopping traversal.`);
        break;
      }

      currentNode = nextNode;
    }

    if (iteration >= MAX_ITERATIONS) {
      putSystemMessage('Maximum iterations reached. Stopping traversal.');
    }

    putSystemMessage('Conversation graph traversal completed.');

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
    putSystemMessage('Error during conversation graph execution', { error });

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
