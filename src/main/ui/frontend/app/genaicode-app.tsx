import { useContext, useEffect } from 'react';
import { ThemeProvider } from 'styled-components';
import { lightTheme, darkTheme } from './theme/theme.js';
import { AppLayout } from './components/app-layout.js';
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
import { GenAIcodeNotifications } from './notifications/genaicode-notifications.js';
import { ChatStateProvider, ChatStateContext } from './contexts/chat-state-context.js';
import { SuggestionGenerator } from './components/suggestion-generator.js';
import { ConversationGraphVisualiser } from './components/chat/conversation-graph-visualiser.js';
import { ConversationGraphStateHandler } from './components/chat/conversation-graph-state-handler.js';
import { TerminalView } from './components/chat/terminal-view.js';
import { ConsoleInterceptor } from '../../../../vite-genaicode/console-interceptor.js';
import { setAppContext } from './api/api-client.js';

const GenAIcodeAppContent = () => {
  // Consume the context to get state and actions
  const {
    messages,
    executionStatus,
    currentQuestion,
    theme,
    usage,
    codegenOptions,
    rcConfig,
    toggleTheme,
    setCodegenOptions, // Get setter for options
    handlePauseExecution,
    handleResumeExecution,
    isTerminalOpen,
    terminalEvents,
    clearTerminalEvents,
  } = useContext(ChatStateContext);

  // Instantiate AppHandlers - It now gets setters from context, only needs codegenOptions
  const { handleExecute, handleQuestionSubmit, handleInterrupt } = AppHandlers({ codegenOptions });

  const currentIterationId =
    executionStatus !== 'idle' && messages.length > 0 ? messages[messages.length - 1].iterationId : null;
  const currentTerminalEvents = (currentIterationId && terminalEvents[currentIterationId]) || [];

  // Polling is handled within the context provider

  // Initialize console interception in dev mode
  useEffect(() => {
    if (!codegenOptions?.isDev) {
      return;
    }

    const maxSize = 50;
    new ConsoleInterceptor(maxSize, async (logs) => {
      try {
        await setAppContext('__console_logs', logs);
      } catch (error) {
        console.warn('Failed to push console logs to app context:', error);
      }
    });

    console.log('GenAIcode: Console log interception enabled in dev mode.');
  }, [codegenOptions?.isDev]);

  const handlePauseResume = () => {
    if (executionStatus === 'paused') {
      handleResumeExecution();
    } else {
      handlePauseExecution();
    }
  };

  // Loading state check (ensure options and usage are loaded)
  if (!usage || !codegenOptions) {
    return (
      <ThemeProvider theme={theme === 'light' ? lightTheme : darkTheme}>
        <GlobalStyle />
        <div>Loading...</div> {/* Basic loading indicator */}
      </ThemeProvider>
    );
  }

  const isExecuting = executionStatus !== 'idle';

  return (
    <ThemeProvider theme={theme === 'light' ? lightTheme : darkTheme}>
      <GlobalStyle />
      {/* SuggestionGenerator is already inside the provider in App component */}
      <AppLayout
        themeToggle={<ThemeToggle theme={theme} toggleTheme={toggleTheme} />}
        toggleTheme={toggleTheme} // Pass toggleTheme if AppLayout needs it
        chatInterface={
          <ChatInterface
            messages={messages}
            currentQuestion={currentQuestion}
            codegenOptions={codegenOptions} // Pass options from context
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
              isExecuting={isExecuting} // Derived from executionStatus
              onInterrupt={handleInterrupt}
              codegenOptions={codegenOptions} // Pass options from context
              onOptionsChange={setCodegenOptions} // Pass the setter directly
            />
          )
        }
        usage={usage} // Pass usage from context
      />

      {isTerminalOpen && currentIterationId && (
        <TerminalView events={currentTerminalEvents} onClear={() => clearTerminalEvents(currentIterationId)} />
      )}

      <ContentGenerationModal currentService={codegenOptions.aiService} />
      <HealthCheckModal />
      <ServiceConfigurationModal />
      <RcConfigModal rcConfig={rcConfig} />
      {/* Pass setCodegenOptions directly if GenaicodeConfigModal modifies options */}
      <GenaicodeConfigModal options={codegenOptions} onOptionsChange={setCodegenOptions} />
      <GenAIcodeNotifications currentQuestion={currentQuestion} messages={messages} />
      <ConversationGraphVisualiser />
      <ConversationGraphStateHandler />
    </ThemeProvider>
  );
};

export function App() {
  return (
    // Wrap the application content with the ChatStateProvider
    // This ensures context is available to all components
    <ChatStateProvider>
      <SuggestionGenerator /> {/* Render SuggestionGenerator within the provider */}
      <GenAIcodeAppContent /> {/* Render the main app content */}
    </ChatStateProvider>
  );
}
