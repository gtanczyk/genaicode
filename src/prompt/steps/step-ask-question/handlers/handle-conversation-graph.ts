import { ActionHandlerProps, ActionResult, SendMessageArgs } from '../step-ask-question-types';
import { putAssistantMessage, putSystemMessage, putUserMessage } from '../../../../main/common/content-bus.js';
import { FunctionCall, ModelType } from '../../../../ai-service/common-types.js';
import { getFunctionDefs } from '../../../function-calling.js';
import { ConversationEdge, ConversationGraphCall } from '../../../function-defs/conversation-graph.js';
import { getActionHandler } from '../step-ask-question';

export const CONVERSATION_GRAPH_DOCS = `# Task Planning and Execution Guide

To effectively help users with their tasks, follow these guidelines to create a structured approach:

## Understanding and Planning

1. **Initial Assessment**:
   - Understand the user's primary goal
   - Identify key requirements and constraints
   - Consider potential challenges
   - Plan necessary steps for completion

2. **Structure**:
   - Break down the task into clear, manageable steps
   - Identify points where decisions or user input are needed
   - Plan alternative approaches based on different scenarios
   - Consider error handling and edge cases

## Steps and Actions

Each step in the process should have:

1. **Clear Purpose**: What this step aims to achieve

2. **Appropriate Action**: Choose the right type of action based on the step's purpose:
   - Gathering information
   - Analyzing requirements
   - Confirming decisions
   - Implementing changes
   - Validating results

3. **Clear Instructions**: Internal guidance for executing the action:
   - What information to gather
   - What aspects to analyze
   - What to validate or confirm
   - How to proceed based on different outcomes

## Transitions and Flow

Define clear conditions for moving between steps:

1. **When to proceed**: Clear criteria for moving forward
2. **Alternative paths**: How to handle different scenarios
3. **Error handling**: What to do when things don't go as planned
4. **Validation**: Ensuring each step is completed successfully

## Nodes and Instructions

Each node in the conversation graph must have three key components:

1. **id**: A unique identifier for the node

2. **actionType**: The specific action to perform at this step. Choose carefully based on the node's purpose.

3. **instruction**: This is critical - it's your internal guidance for executing the node's action. 
   - This is NOT shown to the user
   - Write clear instructions to yourself (the LLM) about HOW to execute the actionType
   - Be specific about what information to gather or provide

## Edges and Conditions

Edges define the flow between nodes. Each edge needs:

1. **sourceNode**: The starting node's id
2. **targetNode**: The destination node's id
3. **instruction**: When to follow this edge. Be specific:
   - This is NOT shown to the user
   - Use "always" or "true" for unconditional transitions
   - For conditional transitions, clearly describe the condition
   - Base conditions on user responses or action outcomes

## Best Practices

1. **User-Focused**: Keep the user's goal in mind at all times
2. **Clear Communication**: Ensure each interaction has a clear purpose
3. **Flexible Approach**: Be ready to adapt based on user responses
4. **Progressive Implementation**: Start with core requirements, then add enhancements
5. **Comprehensive Coverage**: Account for various scenarios and edge cases
6. **Quality Assurance**: Validate results at key points`;

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
          text: CONVERSATION_GRAPH_DOCS,
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
      let outgoingEdge: ConversationEdge | undefined;

      // TODO: Need to use LLM to pick the right edge based on the instruction, no matter if 1 or multiple edges
      //       Some edges may have conditions, so need to evaluate them, and even stop traversal if needed
      //       Also the last user message should be used to evaluate the conditions
      //       Because the user may want to stop the traversal or go to a specific node
      if (outgoingEdges.length === 1) {
        // TODO: Temporary solution to pick the first edge if only one is available
        outgoingEdge = outgoingEdges[0];
      } else if (outgoingEdges.length > 1) {
        // Find valid outgoing edge
      }

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
