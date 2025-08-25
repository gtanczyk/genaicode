import { styled, css, keyframes } from 'styled-components';
import { MessageContainer, MessageBubble } from './message-container-styles.js';
import { LogLevelColors } from './terminal-view-styles.js';

export const InlineContainer = styled(MessageContainer)`
  /* no extra rules needed; keeps alignment with assistant messages */
`;

export const InlineButton = styled(MessageBubble).attrs({ as: 'button' })<{ flashing: boolean }>`
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  cursor: pointer;
  border: 1px solid transparent;
  text-align: left;
  &:hover {
    border-color: ${({ theme }) => theme.colors.border};
  }
  position: relative;
  outline: none;
  ${({ flashing }) =>
    flashing &&
    css`
      @keyframes flash {
        0%,
        100% {
          box-shadow: 0 0 0 0 rgba(231, 76, 60, 0);
        }
        50% {
          box-shadow: 0 0 0 4px rgba(231, 76, 60, 0.35);
        }
      }
      animation: flash 1.2s ease-in-out infinite;
    `}
`;

export const LevelPill = styled.span<{ level: keyof typeof LogLevelColors }>`
  background-color: ${({ level }) => LogLevelColors[level] || '#7f8c8d'};
  color: #fff;
  padding: 2px 6px;
  border-radius: 6px;
  font-size: 0.75em;
  text-transform: uppercase;
  flex-shrink: 0;
`;

export const Snippet = styled.span`
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: ${({ theme }) => theme.colors.text};
`;

export const Timestamp = styled.span`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 0.75em;
  flex-shrink: 0;
`;

export const FlashDot = styled.span`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: ${({ theme }) => theme.colors.error};
  flex-shrink: 0;
`;
