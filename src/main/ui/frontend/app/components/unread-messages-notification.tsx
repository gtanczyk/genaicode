import React from 'react';
import styled, { keyframes } from 'styled-components';

interface UnreadMessagesNotificationProps {
  onClick: () => void;
}

export const UnreadMessagesNotification: React.FC<UnreadMessagesNotificationProps> = ({ onClick }) => {
  return (
    <NotificationContainer onClick={onClick}>
      <NotificationText>New messages</NotificationText>
      <NotificationDot />
      <NotificationDot />
      <NotificationDot />
    </NotificationContainer>
  );
};

const pulse = keyframes`
  0%, 80%, 100% { 
    transform: scale(0.8);
  }
  40% { 
    transform: scale(1.2);
  }
`;

const NotificationContainer = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 10px;
  background-color: ${props => props.theme.colors.primary};
  color: ${props => props.theme.colors.text};
  border-radius: 20px;
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  cursor: pointer;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
  transition: all 0.3s ease;

  &:hover {
    background-color: ${props => props.theme.colors.primaryHover};
  }
`;

const NotificationText = styled.span`
  margin-right: 10px;
  font-weight: bold;
`;

const NotificationDot = styled.div`
  width: 8px;
  height: 8px;
  background-color: ${props => props.theme.colors.text};
  border-radius: 50%;
  margin: 0 2px;
  animation: ${pulse} 1.4s infinite ease-in-out both;

  &:nth-child(2) {
    animation-delay: -0.32s;
  }

  &:nth-child(3) {
    animation-delay: -0.16s;
  }
`;