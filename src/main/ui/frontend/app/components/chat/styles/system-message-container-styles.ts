import styled from 'styled-components';

export const SystemMessageContainer = styled.div<{ isExecutionEnd?: boolean }>`
  background-color: ${(props) => props.theme.colors.systemMessageBackground};
  color: ${(props) => props.theme.colors.systemMessageText};
  border: 1px solid ${(props) => props.theme.colors.systemMessageBorder};
  border-radius: 8px;
  padding: 8px 12px;
  margin: 8px 0;
  font-style: italic;
  font-size: 0.9em;
  opacity: 0.8;
  transition: margin 0.2s ease-in-out;

  /* Increase bottom margin when followed by a codegen view */
  & + div {
    margin-top: 16px;
  }

  ${(props) =>
    props.isExecutionEnd &&
    `
    border-bottom: 3px solid ${props.theme.colors.primary};
  `}
`;

export const SystemMessageHeader = styled.div`
  cursor: pointer;
  font-weight: bold;
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 4px;

  &:hover {
    opacity: 0.8;
  }
`;

export const SystemMessageContent = styled.div`
  white-space: pre-wrap;
  word-wrap: break-word;
  font-family: inherit;
  margin: 0;

  /* Add spacing between content sections */
  & > *:not(:last-child) {
    margin-bottom: 12px;
  }
`;

export const SystemMessagePart = styled.div`
  margin-bottom: 8px;
  position: relative;
  padding-right: 150px; /* Space for timestamp and data link */

  &:last-child {
    margin-bottom: 0;
  }
`;

export const SystemMessageTimestamp = styled.div`
  font-size: 0.8em;
  color: ${(props) => props.theme.colors.systemMessageTimestamp};
  position: absolute;
  right: 60px;
  top: 0;
`;

export const ShowDataLink = styled.span`
  font-size: 0.8em;
  color: ${(props) => props.theme.colors.primary};
  cursor: pointer;
  text-decoration: underline;
  position: absolute;
  right: 0;
  top: 0;

  &:hover {
    color: ${(props) => props.theme.colors.primaryHover};
  }
`;
