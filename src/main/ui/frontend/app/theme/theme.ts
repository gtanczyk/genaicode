import { DefaultTheme } from 'styled-components';

import backgroundLight from '../../../../../../media/logo.png';
import backgroundDark from '../../../../../../media/logo-dark.png';

const lightTheme: DefaultTheme = {
  name: 'light',
  colors: {
    background: '#ffffffaa',
    pageBackground: '#ffffff',
    backgroundSecondary: '#f6f8fa',
    text: '#333333',
    textSecondary: '#6a737d',
    primary: '#0366d6',
    primaryHover: '#0255b3',
    error: '#cc0000',
    secondary: '#6a737d',
    border: '#e1e4e8',
    buttonBg: '#fafbfc',
    buttonText: '#24292e',
    buttonHoverBg: '#f3f4f6',
    inputBg: '#ffffff',
    inputBorder: '#e1e4e8',
    inputText: '#24292e',
    codeBackground: '#f6f8fa',
    codeText: '#24292e',
    systemMessageBackground: '#f0f4f8',
    systemMessageText: '#57606a',
    systemMessageBorder: '#d0d7de',
    systemMessageTimestamp: '#8b949e',
    disabled: '#d1d5da',
    userMessageBackground: '#e1f0ff',
    userMessageText: '#0366d6',
  },
  backgroundImage: backgroundLight,
};

const darkTheme: DefaultTheme = {
  name: 'dark',
  colors: {
    background: '#00000055',
    pageBackground: '#1e1e1e',
    backgroundSecondary: '#2d333b',
    text: '#d4d4d4',
    textSecondary: '#8b949e',
    primary: '#58a6ff',
    primaryHover: '#79b8ff',
    secondary: '#8b949e',
    error: '#cc0000',
    border: '#30363d',
    buttonBg: '#21262d',
    buttonText: '#c9d1d9',
    buttonHoverBg: '#30363d',
    inputBg: '#0d1117',
    inputBorder: '#30363d',
    inputText: '#c9d1d9',
    codeBackground: '#161b22',
    codeText: '#c9d1d9',
    systemMessageBackground: '#1c2128',
    systemMessageText: '#8b949e',
    systemMessageBorder: '#30363d',
    systemMessageTimestamp: '#6e7681',
    disabled: '#41464b',
    userMessageBackground: '#1f4a7d',
    userMessageText: '#58a6ff',
  },
  backgroundImage: backgroundDark,
};

export { lightTheme, darkTheme };
