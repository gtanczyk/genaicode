import { useEffect } from 'react';
import { ThemeProvider } from 'styled-components';
import { lightTheme, darkTheme } from './theme/theme.js';
import { AppLayout } from './components/app-layout.js';
import { AppState } from './components/app-state.js';
import { AppHandlers } from './components/app-handlers.js';
import { ChatInterface } from './components/chat-interface.js';
import { InputArea } from './components/input-area/input-area.js';
import { ThemeToggle } from './components/theme-toggle.js';
import { InfoIcon } from './components/info-icon.js';
import { GlobalStyle } from './theme/global-style.js';

const GenAIcodeApp = () => {
  const {
    currentPrompt,
    setCurrentPrompt,
    isExecuting,
    setIsExecuting,
    executionStatus,
    setExecutionStatus,
    chatMessages,
    setChatMessages,
    currentQuestion,
    setCurrentQuestion,
    theme,
    totalCost,
    codegenOptions,
    rcConfig,
    toggleTheme,
    fetchCodegenData,
    fetchTotalCost,
    updateCodegenOptions,
    setLastFinishedExecutionId,
    startPolling,
    stopPolling,
    handlePauseExecution,
    handleResumeExecution,
  } = AppState();

  const { handleExecute, handleQuestionSubmit, handleInterrupt, handleOptionsChange } = AppHandlers({
    currentPrompt,
    setCurrentPrompt,
    isExecuting,
    setIsExecuting,
    setExecutionStatus,
    chatMessages,
    setChatMessages,
    setCurrentQuestion,
    codegenOptions,
    setCodegenOptions: updateCodegenOptions,
    fetchCodegenData,
    fetchTotalCost,
    setLastFinishedExecutionId,
  });

  useEffect(() => {
    startPolling();
    return () => {
      stopPolling();
    };
  }, [startPolling, stopPolling]);

  const handlePauseResume = () => {
    if (executionStatus === 'paused') {
      handleResumeExecution();
    } else {
      handlePauseExecution();
    }
  };

  return (
    <ThemeProvider theme={theme === 'light' ? lightTheme : darkTheme}>
      <GlobalStyle />
      <AppLayout
        themeToggle={<ThemeToggle theme={theme} toggleTheme={toggleTheme} />}
        infoIcon={<InfoIcon rcConfig={rcConfig} />}
        chatInterface={
          <ChatInterface
            messages={chatMessages}
            currentQuestion={currentQuestion}
            onQuestionSubmit={handleQuestionSubmit}
            onInterrupt={handleInterrupt}
            onPauseResume={handlePauseResume}
            executionStatus={executionStatus}
          />
        }
        inputArea={
          !isExecuting && (
            <InputArea
              onSubmit={handleExecute}
              isExecuting={isExecuting}
              onInterrupt={handleInterrupt}
              codegenOptions={codegenOptions}
              onOptionsChange={handleOptionsChange}
            />
          )
        }
        totalCost={totalCost}
      />
    </ThemeProvider>
  );
};

export function App() {
  return <GenAIcodeApp />;
}
