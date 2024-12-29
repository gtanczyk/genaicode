import React, { useState } from 'react';
import styled from 'styled-components';
import { diffLines } from 'diff';

interface DiffViewProps {
  oldContent?: string;
  newContent: string;
}

export const DiffView: React.FC<DiffViewProps> = ({ oldContent, newContent }) => {
  const [viewMode, setViewMode] = useState<'unified' | 'sideBySide' | 'old' | 'new'>('unified');
  const diff = diffLines(oldContent ?? '', newContent);

  const renderUnifiedDiff = () => (
    <DiffContainer>
      {diff.map((part, index) => (
        <DiffLine key={index} added={part.added} removed={part.removed}>
          {part.value}
        </DiffLine>
      ))}
    </DiffContainer>
  );

  const renderSideBySideDiff = () => (
    <SideBySideContainer>
      <DiffColumn>
        <DiffHeader>Old Content</DiffHeader>
        {diff
          .filter((part) => !part.added)
          .map((part, index) => (
            <DiffLine key={index} removed={part.removed}>
              {part.value}
            </DiffLine>
          ))}
      </DiffColumn>
      <DiffColumn>
        <DiffHeader>New Content</DiffHeader>
        {diff
          .filter((part) => !part.removed)
          .map((part, index) => (
            <DiffLine key={index} added={part.added}>
              {part.value}
            </DiffLine>
          ))}
      </DiffColumn>
    </SideBySideContainer>
  );

  const renderOldContent = () => (
    <ContentContainer>
      <DiffHeader>Old Content</DiffHeader>
      <Content>{oldContent}</Content>
    </ContentContainer>
  );

  const renderNewContent = () => (
    <ContentContainer>
      <DiffHeader>New Content</DiffHeader>
      <Content>{newContent}</Content>
    </ContentContainer>
  );

  return (
    <Container>
      <ViewModeSelector>
        <ViewModeButton active={viewMode === 'unified'} onClick={() => setViewMode('unified')}>
          Unified
        </ViewModeButton>
        <ViewModeButton active={viewMode === 'sideBySide'} onClick={() => setViewMode('sideBySide')}>
          Side by Side
        </ViewModeButton>
        <ViewModeButton active={viewMode === 'old'} onClick={() => setViewMode('old')}>
          Old Content
        </ViewModeButton>
        <ViewModeButton active={viewMode === 'new'} onClick={() => setViewMode('new')}>
          New Content
        </ViewModeButton>
      </ViewModeSelector>

      {viewMode === 'unified' && renderUnifiedDiff()}
      {viewMode === 'sideBySide' && renderSideBySideDiff()}
      {viewMode === 'old' && renderOldContent()}
      {viewMode === 'new' && renderNewContent()}
    </Container>
  );
};

const Container = styled.div`
  margin: 16px 0;
`;

const ViewModeSelector = styled.div`
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
`;

const ViewModeButton = styled.button<{ active: boolean }>`
  padding: 4px 8px;
  border: 1px solid ${(props) => props.theme.colors.border};
  border-radius: 4px;
  background-color: ${(props) => (props.active ? props.theme.colors.primary : props.theme.colors.background)};
  color: ${(props) => (props.active ? props.theme.colors.textOnPrimary : props.theme.colors.text)};
  cursor: pointer;
  font-size: 0.8em;

  &:hover {
    background-color: ${(props) => props.theme.colors.primaryHover};
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

const SideBySideContainer = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin: 16px 0;
`;

const DiffColumn = styled.div`
  padding: 8px;
  border: 1px solid ${(props) => props.theme.colors.border};
  border-radius: 4px;
  background-color: ${(props) => props.theme.colors.background};
  max-height: 400px;
  overflow-y: auto;
`;

const ContentContainer = styled.div`
  margin: 16px 0;
  padding: 8px;
  border: 1px solid ${(props) => props.theme.colors.border};
  border-radius: 4px;
  background-color: ${(props) => props.theme.colors.background};
  max-height: 400px;
  overflow-y: auto;
`;

const DiffHeader = styled.div`
  font-weight: bold;
  margin-bottom: 8px;
`;

const Content = styled.div`
  white-space: pre-wrap;
  font-family: monospace;
  font-size: 0.9em;
  line-height: 1.5;
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
