import React, { useState } from 'react';
import {
  ViewContainer,
  Section,
  SectionHeader,
  SectionContent,
  CollapsibleButton,
  FileList,
  FileItem,
  FileReason,
  FilePath,
  FileDependencies,
  DependencyItem,
  IconContainer,
  DropdownTrigger,
  DropdownContent,
} from './styles/codegen-view-styles.js';
import { CodegenPlanningArgs } from '../../../../../codegen-types.js';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface CodegenPlanningViewProps {
  data: {
    args: CodegenPlanningArgs;
  };
}

export const CodegenPlanningView: React.FC<CodegenPlanningViewProps> = ({ data }) => {
  const [sectionsState, setSectionsState] = useState({
    analysis: true,
    changes: true,
    files: true,
  });
  const [expandedDependencies, setExpandedDependencies] = useState<Record<string, boolean>>({});

  const toggleSection = (section: keyof typeof sectionsState) => {
    setSectionsState((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const toggleDependencies = (filePath: string) => {
    setExpandedDependencies((prev) => ({
      ...prev,
      [filePath]: !prev[filePath],
    }));
  };

  return (
    <ViewContainer>
      <Section>
        <SectionHeader onClick={() => toggleSection('analysis')}>
          <CollapsibleButton expanded={sectionsState.analysis}>
            <IconContainer>{sectionsState.analysis ? '▼' : '▶'}</IconContainer>
            Problem Analysis
          </CollapsibleButton>
        </SectionHeader>
        {sectionsState.analysis && (
          <SectionContent>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{data.args.problemAnalysis}</ReactMarkdown>
          </SectionContent>
        )}
      </Section>

      <Section>
        <SectionHeader onClick={() => toggleSection('changes')}>
          <CollapsibleButton expanded={sectionsState.changes}>
            <IconContainer>{sectionsState.changes ? '▼' : '▶'}</IconContainer>
            Implementation Plan
          </CollapsibleButton>
        </SectionHeader>
        {sectionsState.changes && (
          <SectionContent>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{data.args.codeChanges}</ReactMarkdown>
          </SectionContent>
        )}
      </Section>

      <Section>
        <SectionHeader onClick={() => toggleSection('files')}>
          <CollapsibleButton expanded={sectionsState.files}>
            <IconContainer>{sectionsState.files ? '▼' : '▶'}</IconContainer>
            Affected Files
          </CollapsibleButton>
        </SectionHeader>
        {sectionsState.files && (
          <SectionContent>
            <FileList>
              {data.args.affectedFiles.map((file, index) => (
                <FileItem key={index}>
                  <FilePath>
                    {file.filePath}
                    {file.dependencies && file.dependencies.length > 0 && (
                      <DropdownTrigger onClick={() => toggleDependencies(file.filePath)} title="Dependencies">
                        ({file.dependencies.length})
                      </DropdownTrigger>
                    )}
                  </FilePath>
                  {file.dependencies && file.dependencies.length > 0 && expandedDependencies[file.filePath] && (
                    <DropdownContent>
                      <FileDependencies>
                        Dependencies:
                        {file.dependencies.map((dep, depIndex) => (
                          <DependencyItem key={depIndex}>{dep}</DependencyItem>
                        ))}
                      </FileDependencies>
                    </DropdownContent>
                  )}
                  <FileReason>{file.reason}</FileReason>
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
 * Type guard for codegen planning data
 */
export function isCodegenPlanningData(data: unknown): data is { args: CodegenPlanningArgs } {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;

  if (!obj.args || typeof obj.args !== 'object' || obj.args === null) return false;
  const args = obj.args as Record<string, unknown>;

  return (
    typeof args.problemAnalysis === 'string' &&
    typeof args.codeChanges === 'string' &&
    Array.isArray(args.affectedFiles) &&
    args.affectedFiles.every(
      (file: unknown) =>
        typeof file === 'object' &&
        file !== null &&
        typeof (file as Record<string, unknown>).reason === 'string' &&
        typeof (file as Record<string, unknown>).filePath === 'string',
    )
  );
}
