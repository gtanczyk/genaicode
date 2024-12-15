import styled, { css, keyframes } from 'styled-components';

const fadeIn = keyframes`
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
`;

const slideIn = keyframes`
  from {
    transform: translateX(100%);
  }
  to {
    transform: translateX(0);
  }
`;

export const MenuButton = styled.button`
  background: none;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
  padding: 8px;
  color: ${({ theme }) => theme.colors.text};
  transition: color 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;

  &:hover {
    color: ${({ theme }) => theme.colors.primary};
  }

  &:focus {
    outline: 2px solid ${({ theme }) => theme.colors.primary};
    outline-offset: 2px;
    border-radius: 4px;
  }
`;

export const MenuBackdrop = styled.div<{ isOpen: boolean }>`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  z-index: 998;
  display: ${({ isOpen }) => (isOpen ? 'block' : 'none')};
  animation: ${fadeIn} 0.2s ease;
`;

export const MenuContainer = styled.div<{
  isOpen: boolean;
  position?: { top?: number | string; right?: number | string; left?: number | string; bottom?: number | string };
}>`
  position: absolute;
  ${({ position }) =>
    position
      ? css`
          top: ${position.top ?? 'auto'};
          right: ${position.right ?? 'auto'};
          left: ${position.left ?? 'auto'};
          bottom: ${position.bottom ?? 'auto'};
        `
      : css`
          top: 100%;
          right: 0;
        `}
  background-color: ${({ theme }) => theme.colors.pageBackground};
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  padding: 8px 0;
  min-width: 200px;
  z-index: 999;
  opacity: ${({ isOpen }) => (isOpen ? 1 : 0)};
  visibility: ${({ isOpen }) => (isOpen ? 'visible' : 'hidden')};
  transform-origin: top right;
  animation: ${({ isOpen }) =>
    isOpen
      ? css`
          ${slideIn} 0.2s ease,
          ${fadeIn} 0.2s ease
        `
      : 'none'};

  @media (max-width: 576px) {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    min-width: 250px;
    border-radius: 0;
    border-top-left-radius: 8px;
    border-bottom-left-radius: 8px;
    transform-origin: center right;
  }
`;

export const MenuItem = styled.div`
  padding: 12px 16px;
  cursor: pointer;
  transition: background-color 0.2s ease;
  display: flex;
  align-items: center;
  gap: 8px;
  color: ${({ theme }) => theme.colors.text};

  &:hover {
    background-color: ${({ theme }) => theme.colors.backgroundSecondary};
  }

  &:focus-within {
    background-color: ${({ theme }) => theme.colors.backgroundSecondary};
    outline: 2px solid ${({ theme }) => theme.colors.primary};
    outline-offset: -2px;
  }
`;

export const MenuWrapper = styled.div`
  position: relative;
  display: inline-block;
`;
