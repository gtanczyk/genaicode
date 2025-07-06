import React, { useState } from 'react';
import {
  ViewContainer,
  Section,
  SectionHeader,
  SectionContent,
  CollapsibleButton,
  FileList,
  FileItem,
  FilePath,
  IconContainer,
  UpdateType,
  FilePrompt,
  FileDetailsRow,
  DropdownTrigger,
  DropdownContent,
} from './styles/codegen-view-styles.js';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface FileUpdate {
  id: string;
  dependsOn?: string[];
  prompt: string;
  filePath: string;
  updateToolName: string;
  temperature?: number;
  cheap?: boolean;
}

interface CodegenSummaryData {
  args: {
    explanation: string;
    fileUpdates: FileUpdate[];
    contextPaths: string[];
  };
}

interface CodegenSummaryViewProps {
  data: CodegenSummaryData;
}

export const CodegenSummaryView: React.FC<CodegenSummaryViewProps> = ({ data }) => {
  const [sectionsState, setSectionsState] = useState<{ [key: string]: boolean }>({
    explanation: true,
    updates: true,
    context: false,
  });

  const toggleSection = (section: string) => {
    setSectionsState((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  return (
    <ViewContainer>
      <Section>
        <SectionHeader onClick={() => toggleSection('explanation')}>
          <CollapsibleButton expanded={sectionsState.explanation}>
            <IconContainer>{sectionsState.explanation ? '▼' : '▶'}</IconContainer>
            Explanation
          </CollapsibleButton>
        </SectionHeader>
        {sectionsState.explanation && (
          <SectionContent>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{data.args.explanation}</ReactMarkdown>
          </SectionContent>
        )}
      </Section>

      <Section>
        <SectionHeader onClick={() => toggleSection('updates')}>
          <CollapsibleButton expanded={sectionsState.updates}>
            <IconContainer>{sectionsState.updates ? '▼' : '▶'}</IconContainer>
            File Updates ({data.args.fileUpdates.length})
          </CollapsibleButton>
        </SectionHeader>
        {sectionsState.updates && (
          <SectionContent>
            <FileList>
              {data.args.fileUpdates.map((update, index) => (
                <FileItem key={index} id={'file-update-' + update.id}>
                  <FileDetailsRow>
                    <UpdateType variant={update.updateToolName}>{update.updateToolName}</UpdateType>
                    <FilePath>{update.filePath}</FilePath>
                    <DropdownTrigger onClick={() => toggleSection(update.id)}>{update.id}</DropdownTrigger>
                    {update.temperature && (
                      <UpdateType variant="temperature" title="Temperature">
                        {update.temperature}
                      </UpdateType>
                    )}
                    {update.cheap && (
                      <UpdateType variant="cheap" title="Use cheaper model">
                        Cheap
                      </UpdateType>
                    )}
                  </FileDetailsRow>
                  {update.dependsOn && sectionsState[update.id] && (
                    <DropdownContent>
                      Depends on:{' '}
                      {update.dependsOn?.map((dep) => (
                        <DropdownTrigger
                          key={dep}
                          onClick={() => document.getElementById('file-update-' + dep)?.scrollIntoView()}
                        >
                          {dep}
                        </DropdownTrigger>
                      ))}
                    </DropdownContent>
                  )}
                  <FilePrompt title="Prompt">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{update.prompt}</ReactMarkdown>
                  </FilePrompt>
                </FileItem>
              ))}
            </FileList>
          </SectionContent>
        )}
      </Section>

      <Section>
        <SectionHeader onClick={() => toggleSection('context')}>
          <CollapsibleButton expanded={sectionsState.context}>
            <IconContainer>{sectionsState.context ? '▼' : '▶'}</IconContainer>
            Context Paths ({data.args.contextPaths.length})
          </CollapsibleButton>
        </SectionHeader>
        {sectionsState.context && (
          <SectionContent>
            <FileList>
              {data.args.contextPaths.map((path, index) => (
                <FileItem key={index}>
                  <FilePath>{path}</FilePath>
                </FileItem>
              ))}
            </FileList>
          </SectionContent>
        )}
      </Section>
    </ViewContainer>
  );
};

/**
 * Type guard for codegen summary data
 */
export function isCodegenSummaryData(data: unknown): data is CodegenSummaryData {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;

  if (!obj.args || typeof obj.args !== 'object' || obj.args === null) return false;
  const args = obj.args as Record<string, unknown>;

  return (
    typeof args.explanation === 'string' &&
    Array.isArray(args.fileUpdates) &&
    Array.isArray(args.contextPaths) &&
    args.fileUpdates.every(
      (update: unknown) =>
        typeof update === 'object' &&
        update !== null &&
        typeof (update as Record<string, unknown>).prompt === 'string' &&
        typeof (update as Record<string, unknown>).filePath === 'string' &&
        typeof (update as Record<string, unknown>).updateToolName === 'string',
    )
  );
}
