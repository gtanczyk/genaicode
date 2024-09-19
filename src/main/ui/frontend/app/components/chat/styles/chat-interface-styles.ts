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
