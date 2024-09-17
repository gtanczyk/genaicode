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
`;

export const SystemMessageContent = styled.div`
  white-space: pre-wrap;
  word-wrap: break-word;
  font-family: inherit;
  margin: 0;
`;

export const SystemMessagePart = styled.div`
  margin-bottom: 8px;
`;

export const SystemMessageTimestamp = styled.div`
  font-size: 0.8em;
  color: ${(props) => props.theme.colors.systemMessageTimestamp};
  float: right;
`;

export const ShowDataLink = styled.span`
  font-size: 0.8em;
  color: ${(props) => props.theme.colors.primary};
  cursor: pointer;
  text-decoration: underline;
  float: right;
  margin-right: 5px;

  &:hover {
    color: ${(props) => props.theme.colors.primaryHover};
  }
`;
