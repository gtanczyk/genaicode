import React, { createContext, useState, useEffect, useMemo, useCallback, useRef, ReactNode } from 'react';
import { ChatMessage } from '../../../../common/content-bus-types.js';
import { Question, Usage } from '../../../common/api-types.js';
import { CodegenOptions } from '../../../../codegen-types.js';
import { RcConfig } from '../../../../config-types.js';
import {
  getExecutionStatus,
  getCurrentQuestion,
  getUsage,
  getDefaultCodegenOptions,
  getRcConfig,
  getContent,
  pauseExecution,
  resumeExecution,
} from '../api/api-client.js';

type ExecutionStatus = 'idle' | 'executing' | 'paused';
const POLLING_INTERVAL = 500; // 0.5 seconds

// Define the shape of the context state
interface ChatState {
  messages: ChatMessage[];
  executionStatus: ExecutionStatus;
  currentQuestion: Question | null;
  suggestions: string[];
  currentPrompt: string;
  theme: 'light' | 'dark';
  usage: Usage | undefined;
  codegenOptions: CodegenOptions | undefined;
  rcConfig: RcConfig | null;
  lastFinishedExecutionId: string | null;
  initialDataLoaded: boolean; // Added flag
}

// Define the shape of the context actions/setters
interface ChatActions {
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setExecutionStatus: React.Dispatch<React.SetStateAction<ExecutionStatus>>;
  setCurrentQuestion: React.Dispatch<React.SetStateAction<Question | null>>;
  setSuggestions: React.Dispatch<React.SetStateAction<string[]>>;
  setCurrentPrompt: React.Dispatch<React.SetStateAction<string>>;
  toggleTheme: () => void;
  setCodegenOptions: (options: CodegenOptions) => void; // Keep this signature
  setLastFinishedExecutionId: React.Dispatch<React.SetStateAction<string | null>>;
  startPolling: () => void;
  stopPolling: () => void;
  handlePauseExecution: () => Promise<void>;
  handleResumeExecution: () => Promise<void>;
}

// Create the context with a default value
export const ChatStateContext = createContext<ChatState & ChatActions>({
  messages: [],
  executionStatus: 'idle',
  currentQuestion: null,
  suggestions: [],
  currentPrompt: '',
  theme: 'dark',
  usage: undefined,
  codegenOptions: undefined,
  rcConfig: null,
  lastFinishedExecutionId: null,
  initialDataLoaded: false, // Default value for flag
  setMessages: () => {},
  setExecutionStatus: () => {},
  setCurrentQuestion: () => {},
  setSuggestions: () => {},
  setCurrentPrompt: () => {},
  toggleTheme: () => {},
  setCodegenOptions: () => {},
  setLastFinishedExecutionId: () => {},
  startPolling: () => {},
  stopPolling: () => {},
  handlePauseExecution: async () => {},
  handleResumeExecution: async () => {},
});

// Define the props for the provider
interface ChatStateProviderProps {
  children: ReactNode;
}

// Create the provider component
export const ChatStateProvider: React.FC<ChatStateProviderProps> = ({ children }) => {
  // Existing State
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [executionStatus, setExecutionStatus] = useState<ExecutionStatus>('idle');
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  // State migrated from AppState
  const [currentPrompt, setCurrentPrompt] = useState('');
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [usage, setUsage] = useState<Usage>();
  const [codegenOptions, _setCodegenOptions] = useState<CodegenOptions | undefined>(undefined);
  const [rcConfig, setRcConfig] = useState<RcConfig | null>(null);
  const [lastFinishedExecutionId, setLastFinishedExecutionId] = useState<string | null>(null);
  const isPollingRef = useRef(false);
  const [initialDataLoaded, setInitialDataLoaded] = useState(false); // State for flag
  const pollingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Actions migrated/adapted from AppState
  const toggleTheme = useCallback(() => {
    setTheme((prevTheme) => (prevTheme === 'light' ? 'dark' : 'light'));
  }, []);

  // Keep the signature for setCodegenOptions as it's used directly by consumers
  const setCodegenOptions = useCallback((options: CodegenOptions) => {
    _setCodegenOptions(options);
  }, []);

  const fetchInitialData = useCallback(async () => {
    try {
      const [status, question, content, usageData, defaultOptions, config] = await Promise.all([
        getExecutionStatus(),
        getCurrentQuestion(),
        getContent(),
        getUsage(),
        getDefaultCodegenOptions(),
        getRcConfig(),
      ]);

      setExecutionStatus(status);
      setCurrentQuestion(question);
      setMessages(
        content
          .filter((item) => !!item.message)
          .map((item) => ({
            ...item.message!,
            data: item.data as Record<string, unknown> | undefined,
          })),
      );
      setUsage(usageData);
      _setCodegenOptions(defaultOptions);
      setRcConfig(config);
      setInitialDataLoaded(true); // Set flag after successful fetch
    } catch (error) {
      console.error('Failed to fetch initial data:', error);
      setInitialDataLoaded(false); // Ensure flag is false on error
    }
  }, []);

  useEffect(() => {
    fetchInitialData();
  }, []);

  const pollData = useCallback(async () => {
    try {
      // Only poll essential data frequently
      const [status, question, content, usageData] = await Promise.all([
        getExecutionStatus(),
        getCurrentQuestion(),
        getContent(), // Fetch messages/content
        getUsage(), // Fetch usage
      ]);

      // Add debug log for fetched content
      // console.log('Polling - fetched content:', content); // Keep commented unless debugging

      // Use functional updates to avoid stale state issues if polling is very fast
      // Only update if data has actually changed to prevent unnecessary re-renders
      setExecutionStatus((prevStatus) => (prevStatus !== status ? status : prevStatus));
      setCurrentQuestion((prevQuestion) =>
        // Simplified comparison: check ID change
        prevQuestion?.id !== question?.id ? question : prevQuestion,
      );
      setMessages((prevMessages) => {
        const newMessages: ChatMessage[] = content
          .filter((item) => !!item.message)
          .map((item) => ({ ...item.message!, data: item.data as Record<string, unknown> | undefined }));

        // Keep existing comparison: check length and last message ID
        return prevMessages.length !== newMessages.length ||
          (prevMessages.length > 0 &&
            newMessages.length > 0 &&
            prevMessages[prevMessages.length - 1].id !== newMessages[newMessages.length - 1].id)
          ? newMessages
          : prevMessages;
      });
      setUsage((prevUsage) =>
        // Simplified comparison: check relevant properties
        prevUsage?.usageMetrics.total.cost !== usageData?.usageMetrics.total.cost ||
        prevUsage?.usageMetrics.total.tpd !== usageData?.usageMetrics.total.tpd
          ? usageData
          : prevUsage,
      );
    } catch (error) {
      console.error('Failed to poll data:', error);
      // Consider stopping polling on certain errors, e.g., stopPolling();
    }
    // Schedule next poll only if still polling
    if (pollingTimeoutRef.current) {
      // Check if timeout exists before clearing
      clearTimeout(pollingTimeoutRef.current);
    }
    if (isPollingRef.current) {
      pollingTimeoutRef.current = setTimeout(pollData, POLLING_INTERVAL);
    }
  }, []);

  const startPolling = useCallback(() => {
    if (!isPollingRef.current) {
      console.log('Starting polling...');
      isPollingRef.current = true;
      // Clear any existing timeout before starting a new one
      if (pollingTimeoutRef.current) {
        clearTimeout(pollingTimeoutRef.current);
      }
      // Use requestAnimationFrame to ensure the state update happens before the first poll
      requestAnimationFrame(() => {
        pollData();
      }); // Start polling
    }
  }, [pollData]);

  const stopPolling = useCallback(() => {
    if (isPollingRef.current) {
      console.log('Stopping polling...');
      isPollingRef.current = false;
      if (pollingTimeoutRef.current) {
        clearTimeout(pollingTimeoutRef.current);
        pollingTimeoutRef.current = null;
      }
    }
  }, []);

  // Effect to start/stop polling based on initial data load and isPolling state
  useEffect(() => {
    if (initialDataLoaded) {
      startPolling();
    }

    // Cleanup function to stop polling when the component unmounts
    return () => {
      stopPolling();
    };
    // Depend on initialDataLoaded to trigger startPolling
  }, [initialDataLoaded, startPolling, stopPolling]);

  const handlePauseExecution = useCallback(async () => {
    try {
      await pauseExecution();
      setExecutionStatus('paused');
    } catch (error) {
      console.error('Failed to pause execution:', error);
    }
  }, []);

  const handleResumeExecution = useCallback(async () => {
    try {
      await resumeExecution();
      setExecutionStatus('executing');
    } catch (error) {
      console.error('Failed to resume execution:', error);
    }
  }, []);

  // Memoize the context value
  const contextValue = useMemo(
    () => ({
      messages,
      executionStatus,
      currentQuestion,
      suggestions,
      currentPrompt,
      theme,
      usage,
      codegenOptions,
      rcConfig,
      lastFinishedExecutionId,
      initialDataLoaded, // Include flag in context value
      setMessages,
      setExecutionStatus,
      setCurrentQuestion,
      setSuggestions,
      setCurrentPrompt,
      toggleTheme,
      setCodegenOptions,
      setLastFinishedExecutionId,
      startPolling,
      stopPolling,
      handlePauseExecution,
      handleResumeExecution,
    }),
    [
      messages,
      executionStatus,
      currentQuestion,
      suggestions,
      currentPrompt,
      theme,
      usage,
      codegenOptions,
      rcConfig,
      lastFinishedExecutionId,
      initialDataLoaded, // Include flag in dependencies
      toggleTheme,
      setCodegenOptions,
      startPolling,
      stopPolling,
      handlePauseExecution,
      handleResumeExecution,
    ],
  );

  return <ChatStateContext.Provider value={contextValue}>{children}</ChatStateContext.Provider>;
};

export const useChatState = () => {
  const context = React.useContext(ChatStateContext);
  if (!context) {
    throw new Error('useChatState must be used within a ChatStateProvider');
  }
  return context;
};
