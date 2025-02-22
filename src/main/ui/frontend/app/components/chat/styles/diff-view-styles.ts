import styled from 'styled-components';

export const Container = styled.div`
  margin: 16px 0;
`;

export const ViewModeSelector = styled.div`
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
`;

export const ViewModeButton = styled.button<{ active?: boolean }>`
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

export const DiffContainer = styled.div`
  margin: 16px 0;
  padding: 8px;
  border: 1px solid ${(props) => props.theme.colors.border};
  border-radius: 4px;
  background-color: ${(props) => props.theme.colors.background};
  max-height: 400px;
  overflow-y: auto;
`;

export const SideBySideContainer = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin: 16px 0;
`;

export const DiffColumn = styled.div`
  padding: 8px;
  border: 1px solid ${(props) => props.theme.colors.border};
  border-radius: 4px;
  background-color: ${(props) => props.theme.colors.background};
  max-height: 400px;
  overflow-y: auto;
`;

export const ContentContainer = styled.div`
  margin: 16px 0;
  padding: 8px;
  border: 1px solid ${(props) => props.theme.colors.border};
  border-radius: 4px;
  background-color: ${(props) => props.theme.colors.background};
  max-height: 400px;
  overflow-y: auto;
`;

export const DiffHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: bold;
  margin-bottom: 8px;
  padding: 4px;
`;

export const HeaderContent = styled.span`
  flex: 1;
`;

export const Content = styled.div`
  white-space: pre-wrap;
  font-family: monospace;
  font-size: 0.9em;
  line-height: 1.5;
`;

export const DiffLine = styled.div<{ added?: boolean; removed?: boolean }>`
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

export const HeaderContainer = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  gap: 8px;
`;

export const CopyButtonContainer = styled.div`
  display: flex;
  align-items: center;
  margin-left: 8px;
`;
