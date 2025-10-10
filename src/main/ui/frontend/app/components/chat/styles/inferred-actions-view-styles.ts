import styled from 'styled-components';
import { UpdateType } from './codegen-view-styles';

export const ActionBadge = styled(UpdateType)``;

export const ActionArgsContainer = styled.div`
  margin-top: 8px;
  padding: 12px;
  border-radius: 4px;
  background: ${(props) => props.theme.colors.backgroundSecondary}22;
  border: 1px solid ${(props) => props.theme.colors.border};
  animation: slideDown 0.2s ease;

  pre {
    margin: 0;
    padding: 0;
    background: transparent;
    font-family: 'Courier New', Courier, monospace;
    font-size: 0.9em;
    white-space: pre-wrap;
    word-wrap: break-word;
    color: ${(props) => props.theme.colors.textSecondary};
  }

  @keyframes slideDown {
    from {
      opacity: 0;
      transform: translateY(-10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
`;
