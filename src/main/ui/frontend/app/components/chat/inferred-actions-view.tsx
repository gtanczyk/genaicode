import React from 'react';
import { CompoundActionArgs } from '../../../../../codegen-types.js';
import {
  ViewContainer,
  Section,
  SectionHeader,
  SectionContent,
  FileItem,
  FileDetailsRow,
  FileList,
} from './styles/codegen-view-styles.js';
import { ActionBadge } from './styles/inferred-actions-view-styles.js';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FilePath } from './styles/file-update-view-styles.js';

// Type guard to check if the data is of type CompoundActionArgs
export function isInferredActionsData(data: unknown): data is CompoundActionArgs {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;

  return (
    typeof obj.summary === 'string' &&
    Array.isArray(obj.actions) &&
    obj.actions.every(
      (action: unknown) =>
        typeof action === 'object' &&
        action !== null &&
        typeof (action as Record<string, unknown>).name === 'string' &&
        typeof (action as Record<string, unknown>).filePath === 'string',
    )
  );
}

interface InferredActionsViewProps {
  data: CompoundActionArgs;
}

export const InferredActionsView: React.FC<InferredActionsViewProps> = ({ data }) => {
  return (
    <ViewContainer>
      <Section>
        <SectionHeader>Inferred Actions ({data.actions.length})</SectionHeader>
        <SectionContent>
          {data.summary && <ReactMarkdown remarkPlugins={[remarkGfm]}>{data.summary}</ReactMarkdown>}
          <FileList>
            {data.actions.map((action, index) => (
              <FileItem key={index}>
                <FileDetailsRow>
                  <ActionBadge variant={action.name}>{action.name}</ActionBadge>
                  <FilePath>{action.filePath}</FilePath>
                </FileDetailsRow>
              </FileItem>
            ))}
          </FileList>
        </SectionContent>
      </Section>
    </ViewContainer>
  );
};
