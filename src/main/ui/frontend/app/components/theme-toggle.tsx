import React from 'react';
import styled from 'styled-components';

interface ThemeToggleProps {
  theme: string;
  toggleTheme: () => void;
}

const ToggleButton = styled.button`
  background-color: ${({ theme }) => theme.colors.buttonBg};
  color: ${({ theme }) => theme.colors.buttonText};
  border: 1px solid ${({ theme }) => theme.colors.border};
  padding: 8px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  transition: background-color 0.3s ease;

  &:hover {
    background-color: ${({ theme }) => theme.colors.buttonHoverBg};
  }

  &:focus {
    outline: none;
    box-shadow: 0 0 0 2px ${({ theme }) => theme.colors.primary};
  }
`;

const ThemeToggle: React.FC<ThemeToggleProps> = ({ theme, toggleTheme }) => {
  return (
    <ToggleButton onClick={toggleTheme}>
      {theme === 'light' ? '🌙 Dark Mode' : '☀️ Light Mode'}
    </ToggleButton>
  );
};

export default ThemeToggle;