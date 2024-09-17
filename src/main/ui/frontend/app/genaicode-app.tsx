import 'react';
import { ThemeProvider } from 'styled-components';
import { lightTheme, darkTheme } from './theme/theme.js';
import { AppLayout } from './components/app-layout.js';
import { AppState } from './components/app-state.js';
import { AppHandlers } from './components/app-handlers.js';
import { ChatInterface } from './components/chat-interface.js';
import { InputArea } from './components/input-area.js';
import { ThemeToggle } from './components/theme-toggle.js';
import { InfoIcon } from './components/info-icon.js';
import { ProgressIndicator } from './components/progress-indicator.js';
import { QuestionHandler } from './components/question-handler.js';
import { useEffect } from 'react';
import { GlobalStyle } from './theme/global-style.js';

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
    rcConfig,
    toggleTheme,
    fetchCodegenData,
    fetchTotalCost,
    updateCodegenOptions,
    setLastFinishedExecutionId,
    startPolling,
    stopPolling,
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

  useEffect(() => {
    // Start polling when the app loads
    startPolling();

    // Stop polling when the component unmounts
    return () => {
      stopPolling();
    };
  }, [startPolling, stopPolling]);

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
          currentQuestion ? (
            <QuestionHandler onSubmit={handleQuestionSubmit} question={currentQuestion} />
          ) : (
            <InputArea
              onSubmit={handleExecute}
              onCancel={isExecuting ? handleInterrupt : undefined}
              isExecuting={isExecuting}
              onInterrupt={handleInterrupt}
              onPause={handlePause}
              onResume={handleResume}
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
