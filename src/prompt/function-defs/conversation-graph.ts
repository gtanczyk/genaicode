import { FunctionCall, FunctionDef } from '../../ai-service/common-types.js';
import { ActionType } from '../steps/step-ask-question/step-ask-question-types.js';
import { actionTypeOptions } from './ask-question.js';

// Function definitions for conversation graph

export const conversationGraph: FunctionDef = {
  name: 'conversationGraph',
  description:
    'Define and execute a series of conversation steps to achieve a specific goal. This allows for structured, multi-step conversations with clear transitions between steps.',
  parameters: {
    type: 'object',
    properties: {
      contextAnalysis: {
        type: 'string',
        description: 'A brief summary of the context analysis that led to this conversation graph.',
      },
      bigPicture: {
        type: 'string',
        description: 'A step by step guide to the conversation flow and the desired outcome.',
      },
      entryNode: {
        type: 'string',
        description:
          'The ID of the node where the conversation should start. This node must be defined in the `nodes` array.',
      },
      nodes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            reasoning: {
              type: 'string',
              description: 'Explanation of what this node is trying to achieve.',
            },
            id: {
              type: 'string',
              description: 'A unique identifier for this conversation step. Use short, descriptive names',
            },
            actionType: {
              type: 'string',
              enum: actionTypeOptions,
              description: 'The action to perform at this step.',
            },
            instruction: {
              type: 'string',
              description:
                'Instructions for the LLM on what to achieve at this step. Focus on the desired outcome, not the specific action.',
            },
          },
          required: ['reasoning', 'id', 'actionType', 'instruction'],
        },
        minLength: 1,
        description:
          'An array of conversation steps (nodes). Each node defines an action and how to achieve it. The order in the array does not dictate the flow; use `edges` to define transitions.',
      },
      edges: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            sourceNode: {
              type: 'string',
              description: 'The ID of the node where this transition originates.',
            },
            targetNode: {
              type: 'string',
              description: 'The ID of the node where this transition goes.',
            },
            instruction: {
              type: 'string',
              description:
                'Conditions for this transition. Be specific about when to move from the source to the target node.',
            },
          },
          required: ['sourceNode', 'targetNode', 'instruction'],
        },
        minLength: 1,
        description:
          'An array of transitions (edges) that define the flow between conversation steps. Each edge specifies when to move from one node to another.',
      },
    },
    required: ['contextAnalysis', 'bigPicture', 'entryNode', 'nodes', 'edges'],
  },
};

// Types for conversation graph

export type ConverationNodeId = string & { __type: 'ConverationNodeId' };

export type ConversationEdge = {
  sourceNode: ConverationNodeId;
  targetNode: ConverationNodeId;
  instruction: string;
};

export type ConversationNode = {
  id: ConverationNodeId;
  actionType: ActionType;
  instruction: string;
};

export type ConversationGraphArgs = {
  entryNode: ConverationNodeId;
  nodes: ConversationNode[];
  edges: ConversationEdge[];
};

export type ConversationGraphCall = FunctionCall<ConversationGraphArgs>;

// Function definitions for edge evaluation

export const evaluateEdge: FunctionDef = {
  name: 'evaluateEdge',
  description:
    'Evaluate a conversation edge to determine whether to take the edge, terminate the conversation, or continue evaluating other edges.',
  parameters: {
    type: 'object',
    properties: {
      reasoning: {
        type: 'string',
        description: 'Explanation of why this edge was selected or why no edge was selected',
      },
      selectedEdge: {
        type: 'object',
        description: 'The selected edge to take, or null if no edge should be taken',
        properties: {
          sourceNode: {
            type: 'string',
            description: 'The ID of the node where this transition originates.',
          },
          targetNode: {
            type: 'string',
            description: 'The ID of the node where this transition goes.',
          },
        },
        required: ['sourceNode', 'targetNode'],
      },
      shouldTerminate: {
        type: 'boolean',
        description: 'Whether the conversation should be terminated',
      },
    },
    required: ['reasoning', 'shouldTerminate'],
  },
};

export type EvaluateEdgeArgs = {
  /** Explanation of why this edge was selected or why no edge was selected */
  reasoning: string;
  /** The selected edge to take, or null if no edge should be taken */
  selectedEdge: ConversationEdge | null;
  /** Whether the conversation should be terminated */
  shouldTerminate: boolean;
};

/** Type for function calls with edge evaluation arguments */
export type EvaluateEdgeCall = FunctionCall<EvaluateEdgeArgs>;
