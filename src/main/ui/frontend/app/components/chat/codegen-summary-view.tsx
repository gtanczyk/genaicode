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
import {
  EditableContent,
  EditControls,
  EditButton,
  SaveButton,
  CancelButton,
  LoadingSpinner,
} from './styles/message-container-styles.js';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { editMessage } from '../../api/api-client.js';
import { useChatState } from '../../contexts/chat-state-context.js';

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
  messageId: string;
  data: CodegenSummaryData;
}

export const CodegenSummaryView: React.FC<CodegenSummaryViewProps> = ({ messageId, data }) => {
  const { updateMessage } = useChatState();
  const [sectionsState, setSectionsState] = useState<{ [key: string]: boolean }>({
    explanation: true,
    updates: true,
    context: false,
  });
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState<CodegenSummaryData['args']>({ ...data.args });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleSection = (section: string) => {
    setSectionsState((prev) => ({
      ...prev,
      [section]: !prev[section],
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
      await editMessage(messageId, '', updatedData);
      updateMessage(messageId, { data: updatedData });
      setIsEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setIsLoading(false);
    }
  };

  const updateFileUpdatePrompt = (index: number, prompt: string) => {
    const newFileUpdates = [...editData.fileUpdates];
    newFileUpdates[index] = { ...newFileUpdates[index], prompt };
    setEditData({ ...editData, fileUpdates: newFileUpdates });
  };

  return (
    <ViewContainer>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
        {!isEditing ? (
          <EditButton onClick={handleEditClick} title="Edit summary">
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
        <SectionHeader onClick={() => toggleSection('explanation')}>
          <CollapsibleButton expanded={sectionsState.explanation}>
            <IconContainer>{sectionsState.explanation ? '▼' : '▶'}</IconContainer>
            Explanation
          </CollapsibleButton>
        </SectionHeader>
        {sectionsState.explanation && (
          <SectionContent>
            {isEditing ? (
              <EditableContent
                value={editData.explanation}
                onChange={(e) => setEditData({ ...editData, explanation: e.target.value })}
                placeholder="Explanation..."
                rows={5}
              />
            ) : (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{data.args.explanation}</ReactMarkdown>
            )}
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
              {(isEditing ? editData.fileUpdates : data.args.fileUpdates).map((update, index) => (
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
                      Depends on:{' '}\n                      {update.dependsOn?.map((dep) => (
                        <DropdownTrigger
                          key={dep}
                          onClick={() => document.getElementById('file-update-' + dep)?.scrollIntoView()}
                        >
                          {dep}
                        </DropdownTrigger>
                      ))}
                    </DropdownContent>
                  )}
                  {isEditing ? (
                    <EditableContent
                      value={update.prompt}
                      onChange={(e) => updateFileUpdatePrompt(index, e.target.value)}
                      placeholder="Prompt..."
                      rows={3}
                      style={{ marginTop: '8px' }}
                    />
                  ) : (
                    <FilePrompt title="Prompt">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{update.prompt}</ReactMarkdown>
                    </FilePrompt>
                  )}
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
