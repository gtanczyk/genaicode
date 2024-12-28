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
