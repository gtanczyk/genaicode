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
import { ProgressIndicator } from './components/progress-indicator';
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
    updateCodegenOptions,
    setLastFinishedExecutionId,
  } = AppState();

  const {
    handleExecute,
    handleQuestionSubmit,
    handlePause,
    handleResume,
    handleInterrupt,
    handleOptionsChange,
    isCodegenOngoing,
  } = AppHandlers({
    currentPrompt,
    setCurrentPrompt,
    isExecuting,
    setIsExecuting,
    chatMessages,
    setChatMessages,
    setCurrentQuestion,
    codegenOptions,
    setCodegenOptions: updateCodegenOptions,
    fetchCodegenData,
    fetchTotalCost,
    setLastFinishedExecutionId,
  });

  return (
    <ThemeProvider theme={theme === 'light' ? lightTheme : darkTheme}>
      <GlobalStyle />
      <AppLayout
        themeToggle={<ThemeToggle theme={theme} toggleTheme={toggleTheme} />}
        infoIcon={<InfoIcon rcConfig={rcConfig} />}
        chatInterface={
          <>
            <ChatInterface messages={chatMessages} />
            <ProgressIndicator isVisible={isCodegenOngoing && !currentQuestion} />
          </>
        }
        inputArea={
          <InputArea
            onSubmit={currentQuestion ? handleQuestionSubmit : handleExecute}
            onCancel={isExecuting ? handleInterrupt : undefined}
            isExecuting={isExecuting}
            currentQuestion={currentQuestion?.text}
            onInterrupt={handleInterrupt}
            onPause={handlePause}
            onResume={handleResume}
            codegenOptions={codegenOptions}
            onOptionsChange={handleOptionsChange}
          />
        }
        totalCost={totalCost}
      />
    </ThemeProvider>
  );
};

export function App() {
  return <GenAIcodeApp />;
}
