import styled from 'styled-components';
import { LogLevel } from '../../../../../common/api-types.js';

export const LogLevelColors: Record<LogLevel, string> = {
  info: '#3498db', // Blue
  warn: '#f39c12', // Yellow
  error: '#e74c3c', // Red
  success: '#2ecc71', // Green
  debug: '#9b59b6', // Purple
};

export const TerminalContainer = styled.div`
  position: fixed;
  bottom: 70px;
  right: 20px;
  width: clamp(750px, 50vw, 750px);
  height: 55vh;
  background-color: ${({ theme }) => theme.colors.backgroundAlt || theme.colors.overlayBackground};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25);
  z-index: 1001;
  padding: 12px;
  display: flex;
  flex-direction: column;
  font-family: 'Courier New', Courier, monospace;
`;

export const TerminalHeader = styled.div`
  display: flex;
  align-items: center;
  margin-bottom: 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  color: ${({ theme }) => theme.colors.text};
  gap: 16px;
  flex-wrap: wrap;

  h4 {
    margin: 0;
    font-size: 1.1em;
  }
`;

export const CloseButton = styled.button`
  background: none;
  border: none;
  color: ${({ theme }) => theme.colors.text};
  font-size: 1.2rem;
  cursor: pointer;
  padding: 0;
  line-height: 1;

  &:hover {
    color: ${({ theme }) => theme.colors.primary};
  }
`;

export const ControlBar = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  flex-grow: 1;
  justify-content: flex-end;
`;

export const TabsContainer = styled.div`
  display: flex;
  gap: 5px;
`;

export const TabButton = styled.button<{ active: boolean }>`
  background-color: ${({ active, theme }) => (active ? theme.colors.primary : 'transparent')};
  color: ${({ active, theme }) => (active ? 'white' : theme.colors.text)};
  border: 1px solid ${({ active, theme }) => (active ? theme.colors.primary : theme.colors.border)};
  border-radius: 6px;
  padding: 6px 12px;
  cursor: pointer;
  font-size: 0.9rem;
  font-weight: 500;
  transition: all 0.2s ease-in-out;

  &:hover:not(:disabled) {
    background-color: ${({ theme }) => theme.colors.secondary};
    border-color: ${({ theme }) => theme.colors.secondary};
    color: white;
  }
  margin-left: auto; /* Pushes it to the right */
`;

export const ToggleButton = styled.button<{ active: boolean }>`
  background-color: ${({ active, theme }) => (active ? theme.colors.primary : theme.colors.secondary)};
  color: ${({ active, theme }) => (active ? 'white' : theme.colors.buttonText)};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 6px;
  padding: 6px 10px;
  cursor: pointer;
  font-size: 0.85rem;
  transition: opacity 0.2s ease;

  &:hover {
    opacity: 0.9;
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.colors.primary};
    outline-offset: 2px;
  }
`;

export const TerminalBody = styled.div`
  flex-grow: 1;
  overflow-y: auto;
  background-color: ${({ theme }) => theme.colors.inputBackground};
  padding: 10px;
  border-radius: 6px;
  color: ${({ theme }) => theme.colors.text};
  font-size: 0.9em;
  white-space: pre-wrap;
  word-wrap: break-word;

  &::-webkit-scrollbar {
    width: 8px;
  }
  &::-webkit-scrollbar-track {
    background: ${({ theme }) => theme.colors.background};
  }
  &::-webkit-scrollbar-thumb {
    background-color: ${({ theme }) => theme.colors.border};
    border-radius: 4px;
  }
`;

export const LogLine = styled.div`
  display: grid;
  grid-template-columns: 80px 70px 90px 1fr;
  align-items: start;
  gap: 8px;
  padding-bottom: 6px;
  margin-bottom: 6px;
  border-bottom: 1px dashed ${({ theme }) => theme.colors.border};
  line-height: 1.4;

  .timestamp {
    color: ${({ theme }) => theme.colors.textSecondary};
    font-size: 0.8em;
    white-space: nowrap;
  }

  .source {
    color: ${({ theme }) => theme.colors.textSecondary};
    font-style: italic;
    word-break: break-word;
  }

  @media (max-width: 520px) {
    grid-template-columns: 110px 1fr;
    .source {
      grid-column: 2;
    }
  }
`;

export const LevelBadge = styled.span<{ level: LogLevel }>`
  background-color: ${({ level }) => LogLevelColors[level] || '#7f8c8d'};
  color: white;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.8em;
  font-weight: bold;
  text-transform: uppercase;
  flex-shrink: 0;
  justify-self: start;
`;

export const MessageCell = styled.div`
  word-wrap: break-word;
  white-space: pre-wrap;
`;

export const PayloadToggle = styled.button`
  background: none;
  border: none;
  color: ${({ theme }) => theme.colors.primary};
  cursor: pointer;
  font-size: 0.8rem;
  margin-left: 8px;
  padding: 0;
  text-decoration: underline;

  &:hover {
    opacity: 0.8;
  }
`;

export const PayloadContainer = styled.div`
  grid-column: 1 / -1;
  background-color: ${({ theme }) => theme.colors.background};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 6px;
  margin-top: 8px;
  padding: 5px;
`;

export const PayloadPre = styled.pre`
  margin: 0;
  padding: 8px;
  font-family: 'Courier New', Courier, monospace;
  font-size: 0.9em;
  white-space: pre-wrap;
  word-wrap: break-word;
  max-height: 220px;
  overflow-y: auto;
  background-color: ${({ theme }) => theme.colors.inputBackground};
  border-radius: 3px;

  &::-webkit-scrollbar {
    width: 8px;
  }
  &::-webkit-scrollbar-track {
    background: ${({ theme }) => theme.colors.background};
  }
  &::-webkit-scrollbar-thumb {
    background-color: ${({ theme }) => theme.colors.border};
    border-radius: 4px;
  }
`;
