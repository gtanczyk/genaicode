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
import {
  EditableContent,
  EditControls,
  EditButton,
  SaveButton,
  CancelButton,
  LoadingSpinner,
} from './styles/message-container-styles.js';
import { CodegenPlanningArgs } from '../../../../../codegen-types.js';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { editMessage } from '../../api/api-client.js';
import { useChatState } from '../../contexts/chat-state-context.js';

interface CodegenPlanningViewProps {
  messageId: string;
  data: {
    args: CodegenPlanningArgs;
  };
}

export const CodegenPlanningView: React.FC<CodegenPlanningViewProps> = ({ messageId, data }) => {
  const { updateMessage } = useChatState();
  const [sectionsState, setSectionsState] = useState({
    analysis: true,
    changes: true,
    files: true,
  });
  const [expandedDependencies, setExpandedDependencies] = useState<Record<string, boolean>>({});
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState<CodegenPlanningArgs>({ ...data.args });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const handleEditClick = () => {
    setEditData({ ...data.args });
    setIsEditing(true);
    setError(null);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditData({ ...data.args });
    setError(null);
  };

  const handleSaveEdit = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const updatedData = { ...data, args: editData };
      await editMessage(messageId, undefined, updatedData);
      updateMessage(messageId, { data: updatedData });
      setIsEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setIsLoading(false);
    }
  };

  const updateAffectedFileReason = (index: number, reason: string) => {
    const newAffectedFiles = [...editData.affectedFiles];
    newAffectedFiles[index] = { ...newAffectedFiles[index], reason };
    setEditData({ ...editData, affectedFiles: newAffectedFiles });
  };

  return (
    <ViewContainer>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
        {!isEditing ? (
          <EditButton onClick={handleEditClick} title="Edit planning">
            ✎ Edit
          </EditButton>
        ) : (
          <EditControls>
            <SaveButton onClick={handleSaveEdit} disabled={isLoading}>
              {isLoading ? <LoadingSpinner /> : 'Save'}
            </SaveButton>
            <CancelButton onClick={handleCancelEdit} disabled={isLoading}>
              Cancel
            </CancelButton>
          </EditControls>
        )}
      </div>
      {error && <div style={{ color: 'red', fontSize: '0.8em', marginBottom: '8px' }}>{error}</div>}

      <Section>
        <SectionHeader onClick={() => toggleSection('analysis')}>
          <CollapsibleButton expanded={sectionsState.analysis}>
            <IconContainer>{sectionsState.analysis ? '▼' : '▶'}</IconContainer>
            Problem Analysis
          </CollapsibleButton>
        </SectionHeader>
        {sectionsState.analysis && (
          <SectionContent>
            {isEditing ? (
              <EditableContent
                value={editData.problemAnalysis}
                onChange={(e) => setEditData({ ...editData, problemAnalysis: e.target.value })}
                placeholder="Problem Analysis..."
                rows={5}
              />
            ) : (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{data.args.problemAnalysis}</ReactMarkdown>
            )}
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
            {isEditing ? (
              <EditableContent
                value={editData.codeChanges}
                onChange={(e) => setEditData({ ...editData, codeChanges: e.target.value })}
                placeholder="Implementation Plan..."
                rows={10}
              />
            ) : (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{data.args.codeChanges}</ReactMarkdown>
            )}
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
              {(isEditing ? editData.affectedFiles : data.args.affectedFiles).map((file, index) => (
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
                  {isEditing ? (
                    <EditableContent
                      value={file.reason}
                      onChange={(e) => updateAffectedFileReason(index, e.target.value)}
                      placeholder="Reason..."
                      rows={2}
                      style={{ marginTop: '4px' }}
                    />
                  ) : (
                    <FileReason>{file.reason}</FileReason>
                  )}
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
