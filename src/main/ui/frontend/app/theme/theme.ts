import { DefaultTheme } from 'styled-components';

const lightTheme: DefaultTheme = {
  name: 'light',
  colors: {
    background: '#ffffff',
    text: '#333333',
    primary: '#0366d6',
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
  },
};

const darkTheme: DefaultTheme = {
  name: 'dark',
  colors: {
    background: '#1e1e1e',
    text: '#d4d4d4',
    primary: '#58a6ff',
    secondary: '#8b949e',
    border: '#30363d',
    buttonBg: '#21262d',
    buttonText: '#c9d1d9',
    buttonHoverBg: '#30363d',
    inputBg: '#0d1117',
    inputBorder: '#30363d',
    inputText: '#c9d1d9',
    codeBackground: '#161b22',
    codeText: '#c9d1d9',
  },
};

export { lightTheme, darkTheme };

// Add theme type definition for TypeScript
declare module 'styled-components' {
  export interface DefaultTheme {
    name: string;
    colors: {
      background: string;
      text: string;
      primary: string;
      secondary: string;
      border: string;
      buttonBg: string;
      buttonText: string;
      buttonHoverBg: string;
      inputBg: string;
      inputBorder: string;
      inputText: string;
      codeBackground: string;
      codeText: string;
    };
  }
}
