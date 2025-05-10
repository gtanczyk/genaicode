import React, { useState } from 'react';
import styled from 'styled-components';
import { FilePath } from './styles/file-update-view-styles.js';
import { DiffView } from './diff-view.js';
import { UpdateType } from './styles/codegen-view-styles.js';

interface FileUpdateViewProps {
  data: { name: string; args: FileUpdate };
}

interface FileUpdate {
  filePath: string;
  explanation?: string;
  oldContent?: string;
  newContent: string;
}

export const FileUpdateView: React.FC<FileUpdateViewProps> = ({
  data: {
    name,
    args: { filePath, explanation, oldContent, newContent },
  },
}) => {
  const [showExplanation, setShowExplanation] = useState(true);
  const [showDiff, setShowDiff] = useState(false);

  return (
    <FileUpdateContainer>
      <FileHeader>
        <UpdateType variant={name}>{name}</UpdateType>
        <FilePath>{filePath}</FilePath>
        <ButtonContainer>
          <Button onClick={() => setShowExplanation(!showExplanation)}>
            {showExplanation ? 'Hide Explanation' : 'Explanation'}
          </Button>
          {(oldContent || newContent) && (
            <Button onClick={() => setShowDiff(!showDiff)}>{showDiff ? 'Hide Diff' : 'Show Diff'}</Button>
          )}
        </ButtonContainer>
      </FileHeader>

      {showExplanation && explanation && <Explanation>{explanation}</Explanation>}

      {showDiff && (
        <DiffViewContainer>
          <DiffView oldContent={oldContent} newContent={newContent} />
        </DiffViewContainer>
      )}
    </FileUpdateContainer>
  );
};

const supportedFileUpdateNames: string[] = [
  'updateFile',
  'createFile',
  'patchFile',
  `createDirectory`,
  `deleteFile`,
  `moveFile`,
  `downloadFile`,
  `splitImage`,
  `resizeImage`,
  `imglyRemoveBackground`,
];

export function isFileUpdateData(data: unknown): data is { name: string; args: FileUpdate } {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;
  if (typeof obj.name !== 'string' || !supportedFileUpdateNames.includes(obj.name)) return false;
  const args = obj.args as Record<string, unknown>;

  return typeof args.filePath === 'string';
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
  gap: 8px;
  align-items: center;
`;

const ButtonContainer = styled.div`
  display: flex;
  gap: 8px;
  margin-left: auto;
`;

const Button = styled.button`
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

const Explanation = styled.div`
  margin-top: 8px;
  padding: 8px;
  border: 1px solid ${(props) => props.theme.colors.border};
  border-radius: 4px;
  background-color: ${(props) => props.theme.colors.background};
  font-size: 0.9em;
  line-height: 1.5;
`;

const DiffViewContainer = styled.div`
  margin: 16px 0;
`;
