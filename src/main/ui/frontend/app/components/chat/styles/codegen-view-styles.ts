import styled, { css, DefaultTheme } from 'styled-components';

export const ViewContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  margin-top: 8px;
  font-size: 0.95em;
`;

export const Section = styled.div`
  border: 1px solid ${(props) => props.theme.colors.border};
  border-radius: 6px;
  overflow: hidden;
  background: ${(props) => props.theme.colors.backgroundSecondary}11;
  transition: all 0.2s ease;

  &:hover {
    border-color: ${(props) => props.theme.colors.primary}66;
  }
`;

export const SectionHeader = styled.div`
  padding: 10px 12px;
  background: ${(props) => props.theme.colors.backgroundSecondary}22;
  cursor: pointer;
  user-select: none;
  transition: background-color 0.2s ease;

  &:hover {
    background: ${(props) => props.theme.colors.backgroundSecondary}44;
  }
`;

export const SectionContent = styled.div`
  padding: 12px;
  border-top: 1px solid ${(props) => props.theme.colors.border};
  animation: slideDown 0.2s ease;
  color: ${(props) => props.theme.colors.textSecondary};
  font-size: 0.95em;

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

  @keyframes slideDown {
    from {
      opacity: 0;
      transform: translateY(-10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
`;

export const CollapsibleButton = styled.div<{ expanded: boolean }>`
  display: flex;
  align-items: center;
  gap: 8px;
  color: ${(props) => props.theme.colors.primary};
  font-weight: 500;

  ${(props) =>
    props.expanded &&
    css`
      margin-bottom: -1px;
    `}
`;

export const IconContainer = styled.span`
  display: inline-block;
  width: 16px;
  height: 16px;
  line-height: 16px;
  text-align: center;
  font-size: 0.8em;
  transition: transform 0.2s ease;
`;

export const FileList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

export const FileItem = styled.div`
  padding: 10px;
  border-radius: 4px;
  background: ${(props) => props.theme.colors.backgroundSecondary}22;
  border: 1px solid ${(props) => props.theme.colors.border};

  &:hover {
    border-color: ${(props) => props.theme.colors.primary}66;
  }
`;

export const FileReason = styled.div`
  color: ${(props) => props.theme.colors.textSecondary};
  font-size: 0.95em;
  font-weight: 500;
  margin-bottom: 6px;
  margin-top: 8px;
`;

export const FilePath = styled.div`
  font-family: monospace;
  padding: 4px 8px;
  padding-left: 0px;
  background: ${(props) => props.theme.colors.codeBackground};
  border-radius: 3px;
  color: ${(props) => props.theme.colors.codeText};
  word-break: break-all;
`;

export const FilePrompt = styled.div`
  margin-top: 8px;
  color: ${(props) => props.theme.colors.textSecondary};
  font-size: 0.95em;
  line-height: 1.4;

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

export const FileDependencies = styled.div`
  font-size: 0.9em;
  color: ${(props) => props.theme.colors.textSecondary};
`;

export const DependencyItem = styled.div`
  margin-top: 4px;
  font-family: monospace;
  color: ${(props) => props.theme.colors.info};
`;

export const DropdownTrigger = styled.div`
  display: inline-block;
  margin-left: 8px;
  padding: 2px 6px;
  border-radius: 3px;
  background: ${(props) => props.theme.colors.backgroundSecondary}22;
  border: 1px solid ${(props) => props.theme.colors.border};
  color: ${(props) => props.theme.colors.textSecondary};
  font-size: 0.85em;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    background: ${(props) => props.theme.colors.backgroundSecondary}44;
    border-color: ${(props) => props.theme.colors.primary}66;
  }
`;

export const DropdownContent = styled.div`
  margin-top: 8px;
  padding: 8px;
  border-radius: 4px;
  background: ${(props) => props.theme.colors.backgroundSecondary}22;
  border: 1px solid ${(props) => props.theme.colors.border};
  animation: slideDown 0.2s ease;
`;

export const CodeBlock = styled.pre`
  margin: 0;
  padding: 12px;
  background: ${(props) => props.theme.colors.codeBackground};
  border-radius: 4px;
  color: ${(props) => props.theme.colors.codeText};
  font-family: monospace;
  font-size: 0.9em;
  line-height: 1.4;
  overflow-x: auto;
  white-space: pre-wrap;
  word-wrap: break-word;
`;

type UpdateVariant = 'createFile' | 'updateFile' | 'deleteFile' | 'moveFile' | 'temperature' | 'cheap' | string;

const getUpdateTypeStyles = (variant: UpdateVariant, theme: DefaultTheme) => {
  switch (variant) {
    case 'createFile':
      return css`
        background: ${theme.colors.info}22;
        color: ${theme.colors.info};
        border-color: ${theme.colors.info}44;
      `;
    case 'updateFile':
      return css`
        background: ${theme.colors.primary}22;
        color: ${theme.colors.primary};
        border-color: ${theme.colors.primary}44;
      `;
    case 'deleteFile':
      return css`
        background: ${theme.colors.error}22;
        color: ${theme.colors.error};
        border-color: ${theme.colors.error}44;
      `;
    case 'moveFile':
      return css`
        background: ${theme.colors.warning}22;
        color: ${theme.colors.warning};
        border-color: ${theme.colors.warning}44;
      `;
    case 'temperature':
      return css`
        background: ${theme.colors.success}22;
        color: ${theme.colors.success};
        border-color: ${theme.colors.success}44;
        margin-left: auto;
      `;
    case 'cheap':
      return css`
        background: ${theme.colors.secondary}22;
        color: ${theme.colors.secondary};
        border-color: ${theme.colors.secondary}44;
      `;
    default:
      return css`
        background: ${theme.colors.secondary}22;
        color: ${theme.colors.secondary};
        border-color: ${theme.colors.secondary}44;
      `;
  }
};

export const UpdateType = styled.div<{ variant: UpdateVariant }>`
  display: inline-block;
  padding: 2px 8px;
  border-radius: 3px;
  font-size: 0.85em;
  font-weight: 500;
  margin-bottom: 6px;
  border: 1px solid;
  ${(props) => getUpdateTypeStyles(props.variant, props.theme)}
`;

export const FileMetadata = styled.div`
  margin-top: 8px;
  font-size: 0.9em;
  color: ${(props) => props.theme.colors.textSecondary};
`;

export const FileDetailsRow = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
`;
