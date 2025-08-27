import styled, { DefaultTheme } from 'styled-components';

export const VisualiserContainer = styled.div`
  position: fixed;
  bottom: 70px; /* Adjust as needed to not overlap input area */
  right: 20px;
  width: 400px;
  max-height: 50vh;
  background-color: ${({ theme }) => theme.colors.backgroundSecondary};
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

export const PlanContent = styled.div`
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

interface StepProps {
  state: 'pending' | 'in-progress' | 'completed' | 'failed' | 'skipped';
}

const stateColors = {
  pending: (theme: DefaultTheme) => theme.colors.textSecondary,
  'in-progress': (theme: DefaultTheme) => theme.colors.info,
  completed: (theme: DefaultTheme) => theme.colors.success,
  failed: (theme: DefaultTheme) => theme.colors.error,
  skipped: (theme: DefaultTheme) => theme.colors.warning,
};

export const StepElement = styled.div<StepProps>`
  background-color: ${({ theme }) => theme.colors.inputBg};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-left: 4px solid ${({ state, theme }) => stateColors[state](theme)};
  border-radius: 4px;
  padding: 8px 12px;
  font-size: 0.9rem;
  color: ${({ theme }) => theme.colors.inputText};
  transition: border-color 0.3s ease;
  display: flex;
  align-items: center;

  strong {
    color: ${({ state, theme }) => stateColors[state](theme)};
  }

  p {
    margin: 5px 0 0 0;
    font-size: 0.8rem;
    color: ${({ theme }) => theme.colors.textSecondary};
  }
`;

export const StepStatus = styled.div<StepProps>`
  font-weight: bold;
  text-transform: capitalize;
  color: ${({ state, theme }) => stateColors[state](theme)};
  margin-right: 10px;
  flex-shrink: 0;
  width: 80px; /* Align states */
`;

export const StepDescription = styled.div`
  display: flex;
  flex-direction: column;
  flex-grow: 1;

  small {
    margin-top: 4px;
    font-size: 0.8em;
    color: ${({ theme }) => theme.colors.textSecondary};
  }
`;

export const Dependencies = styled.div`
  font-size: 0.8rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-top: 5px;
  padding-left: 10px;
  border-left: 2px solid ${({ theme }) => theme.colors.border};
`;
