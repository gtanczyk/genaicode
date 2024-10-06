import styled from 'styled-components';

export const ChatContainer = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: ${(props) => props.theme.colors.background};
  position: relative;
  overflow: hidden;
`;

export const MessagesContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
  overflow-y: auto;
  flex-grow: 1;
  max-height: calc(100% - 60px); // Adjust this value based on the height of your UnreadMessagesNotification
  margin-bottom: 60px; // This should match the height of UnreadMessagesNotification plus its bottom margin
`;

export const IterationContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  border: 1px solid ${(props) => props.theme.colors.border};
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 24px;
`;

export const IterationHeader = styled.h3`
  font-size: 16px;
  font-weight: bold;
  color: ${(props) => props.theme.colors.text};
  margin: 0 0 8px 0;
  display: flex;
  justify-content: space-between;
  align-items: center;

  span {
    font-size: 12px;
    font-weight: normal;
    color: ${(props) => props.theme.colors.textSecondary};
  }
`;

export const ConversationSummary = styled.p`
  font-size: 14px;
  color: ${(props) => props.theme.colors.textSecondary};
  background-color: ${(props) => props.theme.colors.backgroundSecondary};
  padding: 8px;
  border-radius: 4px;
  margin: 0 0 16px 0;
`;

// Update MessageContainer styles to fit within IterationContainer
export const MessageContainer = styled.div`
  margin-bottom: 16px;

  &:last-child {
    margin-bottom: 0;
  }
`;

// Update SystemMessageContainer styles if necessary
export const SystemMessageContainer = styled.div`
  margin-bottom: 16px;

  &:last-child {
    margin-bottom: 0;
  }
`;

export const IterationBreakContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  margin: 16px 0;
  text-align: center;

  hr {
    width: 100%;
    border: none;
    border-top: 1px solid ${(props) => props.theme.colors.border};
    margin-bottom: 8px;
  }

  span {
    font-size: 14px;
    font-weight: bold;
    color: ${(props) => props.theme.colors.text};
    background-color: ${(props) => props.theme.colors.background};
    padding: 0 8px;
    margin-top: -18px; // Adjust this to position the text over the line
  }

  p {
    font-size: 14px;
    color: ${(props) => props.theme.colors.textSecondary};
    margin-top: 8px;
    max-width: 80%;
    white-space: pre-wrap;
    word-break: break-word;
  }
`;
