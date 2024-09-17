import 'styled-components';

// Add theme type definition for TypeScript
declare module 'styled-components' {
  export interface DefaultTheme {
    name: string;
    colors: {
      background: string;
      pageBackground: string;
      backgroundSecondary: string;
      text: string;
      textSecondary: string;
      primary: string;
      primaryHover: string;
      secondary: string;
      error: string;
      warning: string;
      info: string;
      border: string;
      buttonBg: string;
      buttonText: string;
      buttonHoverBg: string;
      inputBg: string;
      inputBorder: string;
      inputText: string;
      codeBackground: string;
      codeText: string;
      systemMessageBackground: string;
      systemMessageText: string;
      systemMessageBorder: string;
      systemMessageTimestamp: string;
      disabled: string;
      userMessageBackground: string;
      userMessageText: string;
    };
  }
}
