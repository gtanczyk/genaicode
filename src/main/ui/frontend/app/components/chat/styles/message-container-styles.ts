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
`;

export const MessageHeader = styled.div`
  font-weight: bold;
  margin-bottom: 4px;
`;

export const MessageContent = styled.pre`
  white-space: pre-wrap;
  word-wrap: break-word;
  font-family: inherit;
  margin: 0;
`;

export const MessageFooter = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 4px;
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
