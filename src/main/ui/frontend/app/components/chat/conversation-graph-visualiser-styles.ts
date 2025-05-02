import styled, { css } from 'styled-components';

export const VisualiserContainer = styled.div`
  position: fixed;
  bottom: 70px; /* Adjust as needed to not overlap input area */
  right: 20px;
  width: 400px;
  max-height: 50vh;
  background-color: ${({ theme }) => theme.colors.backgroundAlt};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 1000;
  overflow: auto;
  padding: 15px;
  display: flex;
  flex-direction: column;
`;

export const VisualiserHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};

  h3 {
    margin: 0;
    font-size: 1rem;
    color: ${({ theme }) => theme.colors.text};
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

export const GraphContent = styled.div`
  flex-grow: 1;
  /* Basic layout for nodes and edges - consider using a graph library for actual rendering */
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

interface NodeProps {
  isActive: boolean;
}

export const NodeElement = styled.div<NodeProps>`
  background-color: ${({ theme }) => theme.colors.inputBg};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 4px;
  padding: 8px 12px;
  font-size: 0.9rem;
  color: ${({ theme }) => theme.colors.inputText};

  ${({ isActive, theme }) =>
    isActive &&
    css`
      border-color: ${theme.colors.primary};
      box-shadow: 0 0 0 2px ${theme.colors.primary}40;
      font-weight: bold;
    `}

  strong {
    color: ${({ theme }) => theme.colors.primary};
  }

  p {
    margin: 5px 0 0 0;
    font-size: 0.8rem;
    color: ${({ theme }) => theme.colors.textSecondary};
  }
`;

export const EdgeElement = styled.div`
  font-size: 0.8rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  padding-left: 15px;
  position: relative;

  &::before {
    content: '->';
    position: absolute;
    left: 0;
    color: ${({ theme }) => theme.colors.primary};
  }
`;
