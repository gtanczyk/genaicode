import styled, { css } from 'styled-components';

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
  color: ${(props) => props.theme.colors.primary};
  font-weight: 500;
  margin-bottom: 6px;
`;

export const FilePath = styled.div`
  font-family: monospace;
  padding: 4px 8px;
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
  white-space: pre-wrap;
`;

export const FileDependencies = styled.div`
  margin-top: 8px;
  font-size: 0.9em;
  color: ${(props) => props.theme.colors.textSecondary};
`;

export const DependencyItem = styled.div`
  margin-left: 16px;
  margin-top: 4px;
  font-family: monospace;
  color: ${(props) => props.theme.colors.info};
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

export const UpdateType = styled.div<{ color: string }>`
  display: inline-block;
  padding: 2px 8px;
  border-radius: 3px;
  font-size: 0.85em;
  font-weight: 500;
  margin-bottom: 6px;
  background: ${(props) => props.color}22;
  color: ${(props) => props.color};
  border: 1px solid ${(props) => props.color}44;
`;
