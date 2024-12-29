import styled from 'styled-components';

export const FilePath = styled.div`
  font-weight: bold;
  font-size: 0.9em;
  color: ${(props) => props.theme.colors.text};
`;

export const FilePrompt = styled.div`
  font-size: 0.8em;
  color: ${(props) => props.theme.colors.textSecondary};
  margin: 4px 0;
`;

export const FileMetadata = styled.div`
  font-size: 0.8em;
  color: ${(props) => props.theme.colors.textSecondary};
  margin: 4px 0;
`;

export const UpdateType = styled.div<{ variant: string }>`
  display: inline-block;
  padding: 2px 4px;
  border-radius: 4px;
  font-size: 0.8em;
  font-weight: bold;
  color: ${(props) => props.theme.colors.text};
  background-color: ${(props) =>
    props.variant === 'updateFile'
      ? props.theme.colors.primary
      : props.variant === 'createFile'
        ? props.theme.colors.success
        : props.theme.colors.warning};
`;

export const ButtonContainer = styled.div`
  display: flex;
  gap: 8px;
`;

export const Button = styled.button`
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

export const ExplanationContainer = styled.div`
  margin: 16px 0;
`;

export const Explanation = styled.div`
  padding: 8px;
  border: 1px solid ${(props) => props.theme.colors.border};
  border-radius: 4px;
  background-color: ${(props) => props.theme.colors.background};
  font-size: 0.9em;
  line-height: 1.5;
`;

export const DiffViewContainer = styled.div`
  margin: 16px 0;
`;
