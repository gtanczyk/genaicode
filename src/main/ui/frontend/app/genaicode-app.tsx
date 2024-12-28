import { useEffect } from 'react';
import { ThemeProvider } from 'styled-components';
import { lightTheme, darkTheme } from './theme/theme.js';
import { AppLayout } from './components/app-layout.js';
import { AppState } from './components/app-state.js';
import { AppHandlers } from './components/app-handlers.js';
import { ChatInterface } from './components/chat-interface.js';
import { InputArea } from './components/input-area/input-area.js';
import { ThemeToggle } from './components/theme-toggle.js';
import { GlobalStyle } from './theme/global-style.js';
import { ContentGenerationModal } from './components/content-generation-modal.js';
import { HealthCheckModal } from './components/health-check-modal.js';
import { ServiceConfigurationModal } from './components/service-configuration/service-configuration-modal.js';
import { RcConfigModal } from './components/rc-config-modal.js';
import { GenaicodeConfigModal } from './components/genaicode-config/genaicode-config-modal.js';

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
    usage,
    codegenOptions,
    rcConfig,
    toggleTheme,
    startPolling,
    stopPolling,
    handlePauseExecution,
    handleResumeExecution,
    setCodegenOptions,
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
    setCodegenOptions,
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

  // Loading
  if (!usage) {
    return (
      <ThemeProvider theme={theme === 'light' ? lightTheme : darkTheme}>
        <GlobalStyle />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider theme={theme === 'light' ? lightTheme : darkTheme}>
      <GlobalStyle />
      <AppLayout
        themeToggle={<ThemeToggle theme={theme} toggleTheme={toggleTheme} />}
        toggleTheme={toggleTheme}
        chatInterface={
          <ChatInterface
            messages={chatMessages}
            currentQuestion={currentQuestion}
            codegenOptions={codegenOptions}
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
        usage={usage}
      />
      <ContentGenerationModal currentService={codegenOptions.aiService} />
      <HealthCheckModal />
      <ServiceConfigurationModal />
      <RcConfigModal rcConfig={rcConfig} />
      <GenaicodeConfigModal options={codegenOptions} onOptionsChange={handleOptionsChange} />
    </ThemeProvider>
  );
};

export function App() {
  return <GenAIcodeApp />;
}
