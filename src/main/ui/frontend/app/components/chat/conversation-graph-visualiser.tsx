import React from 'react';
import { useChatState } from '../../contexts/chat-state-context';
import { ConversationGraphEdge, ConversationGraphNode } from '../../../../common/api-types';
import {
  VisualiserContainer,
  VisualiserHeader,
  CloseButton,
  GraphContent,
  NodeElement,
  EdgeElement,
} from './conversation-graph-visualiser-styles';

export const ConversationGraphVisualiser: React.FC = () => {
  const { conversationGraphState, isGraphVisualiserOpen, toggleGraphVisualiser } = useChatState();

  // Only render if the visualiser is open and the graph is active
  if (!isGraphVisualiserOpen || !conversationGraphState?.isActive) {
    return null;
  }

  const { nodes = [], edges = [], currentNodeId } = conversationGraphState;

  // Basic rendering - consider using a graph library like react-flow for actual rendering
  return (
    <VisualiserContainer>
      <VisualiserHeader>
        <h3>Conversation Flow</h3>
        <CloseButton onClick={toggleGraphVisualiser} aria-label="Close visualiser">
          &times;
        </CloseButton>
      </VisualiserHeader>
      <GraphContent>
        <h4>Nodes:</h4>
        {nodes.map((node: ConversationGraphNode) => (
          <NodeElement key={node.id} isActive={node.id === currentNodeId}>
            <strong>ID: {node.id}</strong> ({node.actionType})<p>{node.instruction}</p>
          </NodeElement>
        ))}
        <h4>Edges:</h4>
        {edges.map((edge: ConversationGraphEdge, index: number) => (
          <EdgeElement key={`${edge.sourceNode}-${edge.targetNode}-${index}`}>
            {edge.sourceNode} to {edge.targetNode}: {edge.instruction}
          </EdgeElement>
        ))}
        {currentNodeId && (
          <p>
            <strong>Current Node:</strong> {currentNodeId}
          </p>
        )}
      </GraphContent>
    </VisualiserContainer>
  );
};
