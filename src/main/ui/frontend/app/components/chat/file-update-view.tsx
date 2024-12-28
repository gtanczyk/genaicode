import React, { useState } from 'react';
import styled from 'styled-components';
import { FilePath } from './styles/file-update-view-styles.js';
import { diffLines } from 'diff';

interface FileUpdateViewProps {
  data: { args: FileUpdate };
}

interface FileUpdate {
  filePath: string;
  explanation?: string;
  oldContent?: string;
  newContent: string;
}

export const FileUpdateView: React.FC<FileUpdateViewProps> = ({
  data: {
    args: { filePath, explanation, oldContent, newContent },
  },
}) => {
  const [showDiff, setShowDiff] = useState(false);
  const diff = diffLines(oldContent ?? '', newContent);

  return (
    <FileUpdateContainer>
      <FileHeader>
        <FilePath>{filePath}</FilePath>
        <Explanation>{explanation}</Explanation>
        <ShowDiffButton onClick={() => setShowDiff(!showDiff)}>{showDiff ? 'Hide diff' : 'Show diff'}</ShowDiffButton>
      </FileHeader>

      {showDiff && (
        <DiffContainer>
          {diff.map((part, index) => (
            <DiffLine key={index} added={part.added} removed={part.removed}>
              {part.value}
            </DiffLine>
          ))}
        </DiffContainer>
      )}
    </FileUpdateContainer>
  );
};

export function isFileUpdateData(data: unknown): data is { args: FileUpdate } {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;
  if (obj.name !== 'updateFile' && obj.name !== 'createFile') return false;
  const args = obj.args as Record<string, unknown>;

  return typeof args.filePath === 'string' && typeof args.newContent === 'string';
}

const FileUpdateContainer = styled.div`
  margin: 16px 0;
  padding: 16px;
  border: 1px solid ${(props) => props.theme.colors.border};
  border-radius: 8px;
  background-color: ${(props) => props.theme.colors.background};
`;

const FileHeader = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;
`;

const ShowDiffButton = styled.button`
  align-self: flex-start;
  padding: 4px 8px;
  border: 1px solid ${(props) => props.theme.colors.border};
  border-radius: 4px;
  background-color: ${(props) => props.theme.colors.background};
  cursor: pointer;
  font-size: 0.8em;
  color: ${(props) => props.theme.colors.text};

  &:hover {
    background-color: ${(props) => props.theme.colors.backgroundHover};
  }
`;

const DiffContainer = styled.div`
  margin: 16px 0;
  padding: 8px;
  border: 1px solid ${(props) => props.theme.colors.border};
  border-radius: 4px;
  background-color: ${(props) => props.theme.colors.background};
  max-height: 400px;
  overflow-y: auto;
`;

const DiffLine = styled.div<{ added?: boolean; removed?: boolean }>`
  white-space: pre-wrap;
  font-family: monospace;
  font-size: 0.9em;
  line-height: 1.5;
  padding: 2px 4px;
  margin: 2px 0;
  background-color: ${(props) =>
    props.added ? props.theme.colors.diffAdded : props.removed ? props.theme.colors.diffRemoved : 'transparent'};
  color: ${(props) =>
    props.added
      ? props.theme.colors.diffAddedText
      : props.removed
        ? props.theme.colors.diffRemovedText
        : props.theme.colors.text};
`;

const Explanation = styled.div`
  margin-top: 16px;
  padding: 8px;
  border: 1px solid ${(props) => props.theme.colors.border};
  border-radius: 4px;
  background-color: ${(props) => props.theme.colors.background};
  font-size: 0.9em;
  line-height: 1.5;
`;
