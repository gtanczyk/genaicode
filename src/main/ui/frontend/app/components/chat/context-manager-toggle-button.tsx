import React from 'react';
import styled, { css } from 'styled-components';
import { ToggleButton } from '../toggle-button.js';
import { ContextManagerIcon } from '../context-manager/context-manager-icon.js';
import { useChatState } from '../../contexts/chat-state-context.js';
import { useContextSize } from '../../hooks/use-context-size.js';
import { getSizeCategory, formatTokenCount } from '../context-manager/tree-utils.js';
import { SizeBadge } from '../context-manager/context-manager-modal-styles.js';

// Container for the fixed button, positioned above the graph toggle button
const FixedButtonContainer = styled.div`
  position: absolute;
  bottom: 100px;
  right: 30px;
  z-index: 1000;
`;

// Wrapper for relative positioning of the badge
const ButtonWrapper = styled.div`
  position: relative;
  display: inline-block;
`;

const ContextManagerToggleButton = styled(ToggleButton)<{ isActive: boolean }>`
  width: 50px;
  height: 50px;
  background-color: ${({ theme }) => theme.colors.primary};
  color: ${({ theme }) => theme.colors.buttonText || '#ffffff'};
  border: none;
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);

  &:hover {
    background-color: ${({ theme }) => theme.colors.primaryHover};
  }

  ${({ isActive, theme }) =>
    isActive &&
    css`
      background-color: ${theme.colors.buttonHoverBg};
      border: 1px solid ${theme.colors.primary};
    `}
`;

export const ContextManagerToggleButtonWrapper: React.FC = () => {
  const { toggleContextManager, isContextManagerOpen, messages } = useChatState();
  const { contextSize } = useContextSize(messages);
  const sizeCategory = contextSize ? getSizeCategory(contextSize) : 'small';
  
  // Extract just the number/unit part (e.g. "2.5K" from "2.5K tokens")
  const formattedSize = contextSize ? formatTokenCount(contextSize).split(' ')[0] : 'N/A';

  return (
    <FixedButtonContainer>
      <ButtonWrapper>
        <ContextManagerToggleButton
          onClick={toggleContextManager}
          aria-label="Toggle Context Manager"
          title="Toggle Context Manager"
          isActive={isContextManagerOpen}
        >
          <ContextManagerIcon />
        </ContextManagerToggleButton>
        {contextSize !== undefined && (
          <SizeBadge category={sizeCategory} title={`Context size: ${formatTokenCount(contextSize)}`}>
            {formattedSize}
          </SizeBadge>
        )}
      </ButtonWrapper>
    </FixedButtonContainer>
  );
};
