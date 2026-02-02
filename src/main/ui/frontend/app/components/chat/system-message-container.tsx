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
import { FileUpdatesView, FileUpdateView, isFileUpdateData, isFileUpdatesData } from './file-update-view.js';
import { InferredActionsView, isInferredActionsData } from './inferred-actions-view.js';

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

  return sections.map((section, sectionIndex) => {
    if (section.parts.length > 0) {
      return (
        <StyledSystemMessageContainer key={`section-${sectionIndex}`} isExecutionEnd={message.isExecutionEnd}>
          <SystemMessageHeader onClick={() => toggleExecutionCollapse(message.id)}>
            ▼ Execution {message.id.split('_')[1]}
          </SystemMessageHeader>
          <SystemMessageContent>
            {section.parts.map((part) => (
              <SystemMessagePart key={part.id}>
                {part.content}
                <SystemMessageTimestamp>{part.timestamp.toLocaleString()}</SystemMessageTimestamp>
                {part.data ? (
                  <ShowDataLink onClick={() => toggleDataVisibility(part.id)}>
                    {visibleDataIds.has(part.id) ? 'Hide data' : 'Show data'}
                  </ShowDataLink>
                ) : null}
                {visibleDataIds.has(part.id) && part.data ? <DataContainer data={part.data} /> : null}
              </SystemMessagePart>
            ))}
          </SystemMessageContent>
        </StyledSystemMessageContainer>
      );
    } else if (section.codegenView) {
      return <React.Fragment key={`view-${sectionIndex}`}>{section.codegenView}</React.Fragment>;
    } else {
      return null;
    }
  });
};

/**
 * Helper function to split message parts into sections based on codegen data
 */
function splitMessageParts(parts: ChatMessage[]): MessageSection[] {
  const sections: MessageSection[] = [];
  let currentParts: ChatMessage[] = [];

  sections.push({ parts: currentParts });

  parts.forEach((part) => {
    currentParts.push(part);

    if (
      isCodegenPlanningData(part.data) ||
      isCodegenSummaryData(part.data) ||
      isFileUpdateData(part.data) ||
      isFileUpdatesData(part.data) ||
      isInferredActionsData(part.data)
    ) {
      // Add the codegen view section
      const codegenView = isCodegenPlanningData(part.data) ? (
        <CodegenPlanningView key={`planning-${part.id}`} messageId={part.id} data={part.data} />
      ) : isCodegenSummaryData(part.data) ? (
        <CodegenSummaryView key={`summary-${part.id}`} messageId={part.id} data={part.data} />
      ) : isFileUpdateData(part.data) ? (
        <FileUpdateView key={`file-update-${part.id}`} data={part.data} />
      ) : isFileUpdatesData(part.data) ? (
        <FileUpdatesView data={part.data} />
      ) : isInferredActionsData(part.data) ? (
        <InferredActionsView data={part.data} />
      ) : null;

      sections.push({
        parts: [],
        codegenView,
      });

      currentParts = [];
      sections.push({ parts: currentParts });
    }
  });

  return sections;
}
