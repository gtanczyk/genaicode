import styled from 'styled-components';

export const ToggleButton = styled.button<{ hasBadge: boolean }>`
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
    background-color: ${(props) => props.theme.colors.error};
  }
`;

export const TerminalToggleButtonWrapper = styled.div`
  position: absolute;
  right: 80px; /* Adjusted to avoid overlap with graph toggle */
  bottom: 16px;
  z-index: 20;
`;
