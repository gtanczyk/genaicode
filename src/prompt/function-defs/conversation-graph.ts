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
          required: ['id', 'actionType', 'instruction'],
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
    required: ['entryNode', 'nodes', 'edges'],
  },
};

// Types for conversation graph

type ConverationNodeId = string & { __type: 'ConverationNodeId' };

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
