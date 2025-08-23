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
  margin-bottom: 24px;
`;

export const IterationHeader = styled.div`
  font-size: 16px;
  font-weight: bold;
  color: ${(props) => props.theme.colors.text};
  background-color: ${(props) => props.theme.colors.backgroundSecondary};
  padding: 12px 16px;
  border-bottom: 1px solid ${(props) => props.theme.colors.border};
  border-top-left-radius: 8px;
  border-top-right-radius: 8px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
  position: sticky;
  top: -22px;
  z-index: 10;

  /* Wrap title in a div to control its layout */
  > .title-wrapper {
    display: flex;
    align-items: start;
    flex-grow: 1;
    overflow: hidden; /* Ensure long text doesn't overflow */
  }

  > .title {
    display: flex;
    align-items: start;
    white-space: nowrap; /* Prevent text wrapping */
    overflow: hidden; /* Hide overflowing text */
    text-overflow: ellipsis; /* Add ellipsis for overflow */
  }

  /* Wrap meta in a div for consistent layout */
  > .meta-wrapper {
    display: flex;
    align-items: center; /* Align meta content vertically */
    flex-shrink: 0; /* Prevent meta from shrinking */
    margin-left: auto; /* Push meta to the right */
  }

  > .meta {
    font-size: 12px;
    font-weight: normal;
    color: ${(props) => props.theme.colors.textSecondary};
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 10px;
    white-space: nowrap;
    overflow: visible;
    text-overflow: ellipsis;
  }
`;

export const DeleteButton = styled.button`
  display: flex;
  justify-content: center;
  align-items: center;
  background-color: transparent;
  border: none;
  color: ${(props) => props.theme.colors.textSecondary};
  cursor: pointer;
  font-size: 16px;
  padding: 4px 8px;
  border-radius: 4px;
  margin-left: 8px;
  z-index: 11;
  position: relative;
  min-width: 24px;
  flex-shrink: 0; /* Prevent the button from shrinking */

  &:hover {
    background-color: ${(props) => props.theme.colors.backgroundSecondary};
    color: ${(props) => props.theme.colors.error};
  }
`;

export const IterationContent = styled.div<{ isCollapsed: boolean }>`
  display: ${(props) => (props.isCollapsed ? 'none' : 'flex')};
  flex-direction: column;
  gap: 8px;
  padding: 16px;
`;

export const ConversationSummary = styled.p`
  font-size: 14px;
  color: ${(props) => props.theme.colors.textSecondary};
  background-color: ${(props) => props.theme.colors.backgroundTertiary};
  padding: 8px;
  border-radius: 4px;
  margin: 0 0 16px 0;
`;

export const SystemMessageContainer = styled.div`
  margin-bottom: 16px;

  &:last-child {
    margin-bottom: 0;
  }
`;

export const CollapseIcon = styled.span`
  &:before {
    content: '▼';
    margin-right: 8px;
  }
`;

export const ExpandIcon = styled.span`
  &:before {
    content: '▶';
    margin-right: 8px;
  }
`;

export const ShowDataLink = styled.span`
  color: ${(props) => props.theme.colors.primary};
  cursor: pointer;
  margin-right: 8px;

  &:hover {
    text-decoration: underline;
  }
`;

export const TerminalToggleButton = styled.button<{ hasBadge: boolean }>`
  position: absolute;
  right: 16px;
  bottom: 16px;
  z-index: 20;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-radius: 20px;
  border: 1px solid ${(props) => props.theme.colors.border};
  background-color: ${({ theme }) => theme.colors.primary};
  color: ${(props) => props.theme.colors.buttonText};
  font-size: 14px;
  cursor: pointer;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);

  &:hover {
    opacity: 0.95;
  }

  &:active {
    transform: translateY(1px);
  }

  /* Attention badge shown when hasBadge is true (e.g., terminal has unseen logs) */
  &::after {
    content: '';
    display: ${(props) => (props.hasBadge ? 'inline-block' : 'none')};
    width: 8px;
    height: 8px;
    margin-left: 4px;
    border-radius: 50%;
    background-color: ${(props) => props.theme.colors.primary};
  }
`;
