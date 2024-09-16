import React from 'react';
import { ThemeProvider } from 'styled-components';
import { createGlobalStyle } from 'styled-components';
import { AppLayout } from './components/app-layout';
import { AppState } from './components/app-state';
import { AppHandlers } from './components/app-handlers';
import { ChatInterface } from './components/chat-interface';
import { InputArea } from './components/input-area';
import { ThemeToggle } from './components/theme-toggle';
import { InfoIcon } from './components/info-icon';
import { lightTheme, darkTheme } from './theme/theme';

const GlobalStyle = createGlobalStyle`
  body {
    background-color: ${({ theme }) => theme.colors.background};
    color: ${({ theme }) => theme.colors.text};
    font-family: Arial, sans-serif;
    margin: 0;
    padding: 0;
    transition: all 0.3s ease;
  }
`;

const GenAIcodeApp = () => {
  const {
    currentPrompt,
    setCurrentPrompt,
    isExecuting,
    setIsExecuting,
    chatMessages,
    setChatMessages,
    currentQuestion,
    setCurrentQuestion,
    theme,
    totalCost,
    codegenOptions,
    setCodegenOptions,
    rcConfig,
    toggleTheme,
    checkExecutionStatus,
    checkCurrentQuestion,
    fetchCodegenData,
    fetchTotalCost,
  } = AppState();

  const { handleExecute, handleQuestionSubmit, handlePause, handleResume, handleInterrupt, handleOptionsChange } =
    AppHandlers({
      currentPrompt,
      setCurrentPrompt,
      isExecuting,
      setIsExecuting,
      chatMessages,
      setChatMessages,
      setCurrentQuestion,
      codegenOptions,
      setCodegenOptions,
      fetchCodegenData,
      fetchTotalCost,
    });

  return (
    <ThemeProvider theme={theme === 'light' ? lightTheme : darkTheme}>
      <GlobalStyle />
      <AppLayout
        themeToggle={<ThemeToggle theme={theme} toggleTheme={toggleTheme} />}
        infoIcon={<InfoIcon rcConfig={rcConfig} />}
        chatInterface={
          <ChatInterface 
            messages={chatMessages} 
          />
        }
        inputArea={
          <InputArea
            onSubmit={currentQuestion ? handleQuestionSubmit : handleExecute}
            onCancel={isExecuting ? handleInterrupt : undefined}
            isExecuting={isExecuting}
            placeholder={
              currentQuestion
                ? "Enter your response to the assistant's question..."
                : 'Enter your codegen prompt here...'
            }
            onInterrupt={handleInterrupt}
            onPause={handlePause}
            onResume={handleResume}
          />
        }
      />
    </ThemeProvider>
  );
};

export function App() {
  return <GenAIcodeApp />;
}