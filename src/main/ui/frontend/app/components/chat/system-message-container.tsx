import React from 'react';
import { ChatMessage, ChatMessageType } from '../../../../../common/content-bus-types.js';
import { DataContainer } from './data-container.js';
import {
  SystemMessageContainer as StyledSystemMessageContainer,
  SystemMessageHeader,
  SystemMessageContent,
  SystemMessagePart,
  SystemMessageTimestamp,
  ShowDataLink,
} from './styles/system-message-container-styles.js';
import { CodegenPlanningView, isCodegenPlanningData } from './codegen-planning-view.js';
import { CodegenSummaryView, isCodegenSummaryData } from './codegen-summary-view.js';

export interface SystemMessageBlock extends Omit<ChatMessage, 'type'> {
  type: ChatMessageType.SYSTEM;
  parts: ChatMessage[];
  isExecutionEnd?: boolean;
}

interface SystemMessageContainerProps {
  message: SystemMessageBlock;
  collapsedExecutions: Set<string>;
  toggleExecutionCollapse: (id: string) => void;
  visibleDataIds: Set<string>;
  toggleDataVisibility: (id: string) => void;
}

interface MessageSection {
  parts: ChatMessage[];
  codegenView?: React.ReactNode;
}

export const SystemMessageContainer: React.FC<SystemMessageContainerProps> = ({
  message,
  collapsedExecutions,
  toggleExecutionCollapse,
  visibleDataIds,
  toggleDataVisibility,
}) => {
  if (collapsedExecutions.has(message.id)) {
    return (
      <StyledSystemMessageContainer isExecutionEnd={message.isExecutionEnd}>
        <SystemMessageHeader onClick={() => toggleExecutionCollapse(message.id)}>
          ▶ Execution {message.id.split('_')[1]}
        </SystemMessageHeader>
      </StyledSystemMessageContainer>
    );
  }

  const sections = splitMessageParts(message.parts);

  return sections.map((section, sectionIndex) => (
    <React.Fragment key={`section-${sectionIndex}`}>
      <StyledSystemMessageContainer isExecutionEnd={message.isExecutionEnd}>
        <SystemMessageHeader onClick={() => toggleExecutionCollapse(message.id)}>
          ▼ Execution {message.id.split('_')[1]}
        </SystemMessageHeader>
        <SystemMessageContent>
          {section.parts.map((part) => (
            <SystemMessagePart key={part.id}>
              {part.content}
              <SystemMessageTimestamp>{part.timestamp.toLocaleString()}</SystemMessageTimestamp>
              {part.data && (
                <ShowDataLink onClick={() => toggleDataVisibility(part.id)}>
                  {visibleDataIds.has(part.id) ? 'Hide data' : 'Show data'}
                </ShowDataLink>
              )}
              {visibleDataIds.has(part.id) && part.data && <DataContainer data={part.data} />}
            </SystemMessagePart>
          ))}
        </SystemMessageContent>
      </StyledSystemMessageContainer>
      {section.codegenView && <React.Fragment key={`view-${sectionIndex}`}>{section.codegenView}</React.Fragment>}
    </React.Fragment>
  ));
};

/**
 * Helper function to split message parts into sections based on codegen data
 */
function splitMessageParts(parts: ChatMessage[]): MessageSection[] {
  const sections: MessageSection[] = [];
  let currentParts: ChatMessage[] = [];

  parts.forEach((part) => {
    if (isCodegenPlanningData(part.data) || isCodegenSummaryData(part.data)) {
      // If we have accumulated regular parts, add them as a section
      if (currentParts.length > 0) {
        sections.push({ parts: [...currentParts] });
        currentParts = [];
      }

      // Add the codegen view section
      const codegenView = isCodegenPlanningData(part.data) ? (
        <CodegenPlanningView key={`planning-${part.id}`} data={part.data} />
      ) : (
        <CodegenSummaryView key={`summary-${part.id}`} data={part.data} />
      );

      sections.push({
        parts: [part],
        codegenView,
      });
    } else {
      currentParts.push(part);
    }
  });

  // Add any remaining regular parts
  if (currentParts.length > 0) {
    sections.push({ parts: currentParts });
  }

  return sections;
}
