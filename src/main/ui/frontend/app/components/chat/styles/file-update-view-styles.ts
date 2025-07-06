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
        : props.variant === 'patchFile'
          ? props.theme.colors.warning
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

  > *:first-child {
    margin-top: 0;
  }

  > *:last-child {
    margin-bottom: 0;
  }

  p {
    margin: 8px 0;
  }

  ul,
  ol {
    padding-left: 20px;
    margin: 8px 0;
  }

  li {
    margin-bottom: 4px;
  }

  pre {
    background-color: ${(props) => props.theme.colors.codeBackground};
    padding: 10px;
    border-radius: 4px;
    font-family: 'Courier New', Courier, monospace;
    white-space: pre-wrap;
    word-wrap: break-word;
    margin: 8px 0;
  }

  code {
    font-family: 'Courier New', Courier, monospace;
    background-color: ${(props) => props.theme.colors.codeBackground};
    padding: 2px 4px;
    border-radius: 3px;
    font-size: 0.9em;
  }

  pre > code {
    background-color: transparent;
    padding: 0;
    border-radius: 0;
    font-size: inherit;
  }

  blockquote {
    border-left: 4px solid ${(props) => props.theme.colors.border};
    padding-left: 10px;
    margin: 8px 0;
    color: ${(props) => props.theme.colors.textSecondary};
  }
`;

export const DiffViewContainer = styled.div`
  margin: 16px 0;
`;
