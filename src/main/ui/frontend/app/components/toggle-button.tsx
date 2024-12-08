import styled from 'styled-components';

export const ToggleButton = styled.button`
  background-color: transparent;
  color: ${({ theme }) => theme.colors.text};
  border: none;
  border-radius: 50%;
  width: 40px;
  height: 40px;
  font-size: 20px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.3s;

  &:hover {
    background-color: ${({ theme }) => theme.colors.buttonHoverBg};
  }

  &:focus {
    outline: none;
    box-shadow: 0 0 0 2px ${({ theme }) => theme.colors.primary};
  }
`;
