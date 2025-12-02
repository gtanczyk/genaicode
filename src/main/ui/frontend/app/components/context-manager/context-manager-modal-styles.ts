import styled from 'styled-components';

export const ModalOverlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: ${(props) => props.theme.colors.menuBackdrop};
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: ${(props) => props.theme.zIndex.modal};
`;

export const ModalContainer = styled.div`
  background-color: ${(props) => props.theme.colors.pageBackground};
  border-radius: 8px;
  width: 90%;
  max-width: 800px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  border: 1px solid ${(props) => props.theme.colors.border};
  color: ${(props) => props.theme.colors.text};
`;

export const ModalHeader = styled.div`
  padding: 16px 20px;
  border-bottom: 1px solid ${(props) => props.theme.colors.border};
  display: flex;
  justify-content: space-between;
  align-items: center;

  h2 {
    margin: 0;
    font-size: 1.2rem;
    color: ${(props) => props.theme.colors.text};
  }
`;

export const CloseButton = styled.button`
  background: none;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
  color: ${(props) => props.theme.colors.textSecondary};
  padding: 0;
  line-height: 1;

  &:hover {
    color: ${(props) => props.theme.colors.text};
  }
`;

export const ModalContent = styled.div`
  padding: 20px;
  overflow-y: auto;
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

export const TreeContainer = styled.div`
  border: 1px solid ${(props) => props.theme.colors.border};
  border-radius: 4px;
  padding: 10px;
  background-color: ${(props) => props.theme.colors.inputBg};
  max-height: 60vh;
  overflow-y: auto;
`;

export const TreeNodeItem = styled.div`
  display: flex;
  align-items: center;
  padding: 4px 0;
  gap: 8px;
  font-family: monospace;
  font-size: 0.9rem;

  &:hover {
    background-color: ${(props) => props.theme.colors.menuHover};
  }
`;

export const Indent = styled.div<{ level: number }>`
  width: ${(props) => props.level * 20}px;
  flex-shrink: 0;
`;

export const Checkbox = styled.input.attrs({ type: 'checkbox' })`
  cursor: pointer;
  margin: 0;
  width: 16px;
  height: 16px;
`;

export const NodeLabel = styled.span<{ type: 'file' | 'folder' }>`
  cursor: pointer;
  color: ${(props) => (props.type === 'folder' ? props.theme.colors.primary : props.theme.colors.text)};
  font-weight: ${(props) => (props.type === 'folder' ? 'bold' : 'normal')};
  flex-grow: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

export const ButtonGroup = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding-top: 16px;
  border-top: 1px solid ${(props) => props.theme.colors.border};
`;

export const Button = styled.button<{ variant?: 'primary' | 'danger' | 'secondary' }>`
  padding: 8px 16px;
  border-radius: 4px;
  border: 1px solid ${(props) => props.theme.colors.border};
  cursor: pointer;
  font-size: 0.9rem;
  transition: background-color 0.2s;

  ${(props) => {
    switch (props.variant) {
      case 'primary':
        return `
          background-color: ${props.theme.colors.primary};
          color: white;
          border-color: ${props.theme.colors.primary};
          &:hover { background-color: ${props.theme.colors.primaryHover}; }
        `;
      case 'danger':
        return `
          background-color: ${props.theme.colors.error};
          color: white;
          border-color: ${props.theme.colors.error};
          &:hover { background-color: ${props.theme.colors.errorHover}; }
        `;
      default:
        return `
          background-color: ${props.theme.colors.buttonBg};
          color: ${props.theme.colors.buttonText};
          &:hover { background-color: ${props.theme.colors.buttonHoverBg}; }
        `;
    }
  }}

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    background-color: ${(props) => props.theme.colors.disabled};
    border-color: ${(props) => props.theme.colors.disabled};
    color: ${(props) => props.theme.colors.textSecondary};
  }
`;

export const EmptyState = styled.div`
  text-align: center;
  padding: 40px;
  color: ${(props) => props.theme.colors.textSecondary};
  font-style: italic;
`;

export const StatsBar = styled.div`
  display: flex;
  gap: 20px;
  font-size: 0.85rem;
  color: ${(props) => props.theme.colors.textSecondary};
  margin-bottom: 8px;
  font-weight: 500;
`;

export const SizeIndicator = styled.span<{ category: 'small' | 'medium' | 'large' }>`
  display: inline-flex;
  align-items: center;
  font-size: 0.8rem;
  margin-left: 8px;
  font-weight: 500;
  color: ${(props) => {
    switch (props.category) {
      case 'small':
        return props.theme.colors.success || '#4CAF50';
      case 'medium':
        return props.theme.colors.warning || '#FFA726';
      case 'large':
        return props.theme.colors.error || '#EF5350';
      default:
        return props.theme.colors.textSecondary;
    }
  }};
`;

export const SizeBadge = styled.div<{ category: 'small' | 'medium' | 'large' }>`
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 20px;
  height: 20px;
  border-radius: 10px;
  font-size: 0.65rem;
  font-weight: bold;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2px 4px;
  color: white;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  background-color: ${(props) => {
    switch (props.category) {
      case 'small':
        return props.theme.colors.success || '#4CAF50';
      case 'medium':
        return props.theme.colors.warning || '#FFA726';
      case 'large':
        return props.theme.colors.error || '#EF5350';
      default:
        return props.theme.colors.textSecondary;
    }
  }};
`;

export const StatsDetail = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.85rem;
`;
