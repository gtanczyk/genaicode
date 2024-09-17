import { createGlobalStyle } from 'styled-components';

export const GlobalStyle = createGlobalStyle`
  body {
    color: ${({ theme }) => theme.colors.text};
    font-family: Arial, sans-serif;
    margin: 0;
    padding: 0;    
    background-color: ${({ theme }) => theme.colors.pageBackground};    
  }

  body::before {
    content: '';
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    transition: all 0.3s ease;
    opacity: 0.1;
    background-image: url(${(props) => props.theme.backgroundImage});
    background-size: cover;
    background-position: center;
    background-repeat: no-repeat;
    background-attachment: fixed;
    z-index: -1;
  }
`;
