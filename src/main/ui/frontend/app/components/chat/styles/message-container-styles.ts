import styled from 'styled-components';

export const MessageContainer = styled.div`
  display: flex;
  &[data-type='user'] {
    justify-content: flex-end;
  }

  &[data-type='assistant'] {
    justify-content: flex-start;
  }
`;

export const MessageBubble = styled.div`
  color: ${(props) => props.theme.colors.text};
  border-radius: 12px;
  padding: 8px 12px;
  max-width: 70%;
  background-color: ${(props) => props.theme.colors.backgroundSecondary};

  ${MessageContainer}[data-type='user'] & {
    background-color: ${(props) => props.theme.colors.userMessageBackground};
    color: ${(props) => props.theme.colors.userMessageText};
  }

  /* Add subtle transition for edit mode */
  transition: box-shadow 0.2s ease-in-out;

  &[data-edit-mode='true'] {
    box-shadow: 0 0 0 2px ${(props) => props.theme.colors.primary};
  }
`;

export const MessageHeader = styled.div`
  font-weight: bold;
  margin-bottom: 4px;
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

export const MessageContent = styled.div`
  word-wrap: break-word;
  font-family: inherit;
  margin: 0;

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

// New component for editable content
export const EditableContent = styled.textarea`
  width: 100%;
  min-height: 100px;
  padding: 8px;
  border: none;
  border-radius: 4px;
  background-color: ${(props) => props.theme.colors.background};
  color: ${(props) => props.theme.colors.text};
  font-family: inherit;
  font-size: inherit;
  resize: vertical;
  margin: 4px 0;
  field-sizing: content;
  box-sizing: border-box;

  &:focus {
    outline: none;
    box-shadow: 0 0 0 1px ${(props) => props.theme.colors.primary};
  }

  ${MessageContainer}[data-type='user'] & {
    background-color: ${(props) => props.theme.colors.userMessageBackground};
    color: ${(props) => props.theme.colors.userMessageText};
  }
`;

export const MessageFooter = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 4px;
  gap: 8px;

  > div {
    display: flex;
    align-items: center;
    gap: 8px;
  }
`;

export const MessageTimestamp = styled.div`
  font-size: 0.8em;
  color: ${(props) => props.theme.colors.textSecondary};

  ${MessageContainer}[data-type='user'] & {
    color: ${(props) => props.theme.colors.userMessageTimestamp};
  }
`;

export const ShowDataLink = styled.span`
  font-size: 0.8em;
  color: ${(props) => props.theme.colors.primary};
  cursor: pointer;
  text-decoration: underline;

  &:hover {
    color: ${(props) => props.theme.colors.primaryHover};
  }
`;

// New components for edit controls
export const EditControls = styled.div`
  display: flex;
  gap: 8px;
  margin-top: 8px;
`;

const BaseButton = styled.button`
  padding: 4px 8px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.8em;
  transition: background-color 0.2s ease-in-out;

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

export const EditButton = styled(BaseButton)`
  background-color: transparent;
  color: ${(props) => props.theme.colors.primary};

  &:hover:not(:disabled) {
    background-color: ${(props) => props.theme.colors.primaryHover}20;
  }

  ${MessageContainer}[data-type='user'] & {
    color: ${(props) => props.theme.colors.userMessageText};
    &:hover:not(:disabled) {
      background-color: ${(props) => props.theme.colors.userMessageText}20;
    }
  }
`;

export const SaveButton = styled(BaseButton)`
  background-color: ${(props) => props.theme.colors.primary};
  color: ${(props) => props.theme.colors.buttonText};

  &:hover:not(:disabled) {
    background-color: ${(props) => props.theme.colors.primaryHover};
  }
`;

export const CancelButton = styled(BaseButton)`
  background-color: transparent;
  color: ${(props) => props.theme.colors.error};

  &:hover:not(:disabled) {
    background-color: ${(props) => props.theme.colors.error}20;
  }
`;

// Added loading indicator styles
export const LoadingSpinner = styled.div`
  width: 16px;
  height: 16px;
  border: 2px solid ${(props) => props.theme.colors.primary};
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin: 0 8px;

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
`;

// Add edited indicator style
export const EditedIndicator = styled.span`
  font-size: 0.7em;
  color: ${(props) => props.theme.colors.textSecondary};
  margin-left: 8px;
  font-style: italic;
`;
