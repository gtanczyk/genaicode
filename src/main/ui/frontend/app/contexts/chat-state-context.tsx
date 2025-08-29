import React, { createContext, useState, useEffect, useMemo, useCallback, useRef, ReactNode } from 'react';
import { ChatMessage } from '../../../../common/content-bus-types.js';
import { Question, Usage, ConversationGraphState, TerminalEvent } from '../../../common/api-types.js'; // Import ConversationGraphState
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
const MAX_TERMINAL_EVENTS = 5000;

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
  conversationGraphState: ConversationGraphState | null; // Added for graph data
  isGraphVisualiserOpen: boolean; // Added for visualiser visibility
  terminalEvents: Record<string, TerminalEvent[]>;
  isTerminalOpen: boolean;
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
  setConversationGraphState: React.Dispatch<React.SetStateAction<ConversationGraphState | null>>;
  toggleGraphVisualiser: () => void;
  toggleTerminal: () => void;
  clearTerminalEvents: (iterationId: string) => void;
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
  initialDataLoaded: false,
  conversationGraphState: null,
  isGraphVisualiserOpen: false,
  terminalEvents: {},
  isTerminalOpen: false,
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
  setConversationGraphState: () => {}, // Default setter
  toggleGraphVisualiser: () => {}, // Default toggle
  toggleTerminal: () => {},
  clearTerminalEvents: () => {},
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

  const [conversationGraphState, setConversationGraphState] = useState<ConversationGraphState | null>(null);
  const [isGraphVisualiserOpen, setIsGraphVisualiserOpen] = useState(false);

  // New state for terminal view
  const [terminalEvents, setTerminalEvents] = useState<Record<string, TerminalEvent[]>>({});
  const [isTerminalOpen, setIsTerminalOpen] = useState(false);
  const [autoScrollTerminal, setAutoScrollTerminal] = useState(true);

  // Actions migrated/adapted from AppState
  const toggleTheme = useCallback(() => {
    setTheme((prevTheme) => (prevTheme === 'light' ? 'dark' : 'light'));
  }, []);

  // Keep the signature for setCodegenOptions as it's used directly by consumers
  const setCodegenOptions = useCallback((options: CodegenOptions) => {
    _setCodegenOptions(options);
  }, []);

  const toggleGraphVisualiser = useCallback(() => {
    setIsGraphVisualiserOpen((prev) => !prev);
  }, []);

  // New actions for terminal view
  const toggleTerminal = useCallback(() => {
    setIsTerminalOpen((prev) => !prev);
  }, []);

  const toggleAutoScrollTerminal = useCallback(() => {
    setAutoScrollTerminal((prev) => !prev);
  }, []);

  const clearTerminalEvents = useCallback((iterationId: string) => {
    setTerminalEvents((prev) => ({ ...prev, [iterationId]: [] }));
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

      // Process content for both messages and terminal events
      const initialMessages: ChatMessage[] = [];
      const initialTerminalEvents: Record<string, TerminalEvent[]> = {};

      for (const item of content) {
        if (item.message) {
          initialMessages.push({
            ...item.message,
            timestamp: new Date(item.message.timestamp),
            data: item.data as Record<string, unknown> | undefined,
          });
        }
        if (item.terminalEvent) {
          const { iterationId } = item.terminalEvent;
          if (!initialTerminalEvents[iterationId]) {
            initialTerminalEvents[iterationId] = [];
          }
          initialTerminalEvents[iterationId].push({
            ...item.terminalEvent,
            timestamp: new Date(item.terminalEvent.timestamp).toString(),
          });
        }
      }

      // Prune terminal events on initial load
      for (const iterationId in initialTerminalEvents) {
        if (initialTerminalEvents[iterationId].length > MAX_TERMINAL_EVENTS) {
          initialTerminalEvents[iterationId] = initialTerminalEvents[iterationId].slice(-MAX_TERMINAL_EVENTS);
        }
      }

      setMessages(initialMessages);
      setTerminalEvents(initialTerminalEvents);
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
  }, [fetchInitialData]);

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
          .map((item) => ({
            ...item.message!,
            timestamp: new Date(item.message!.timestamp), // Convert string to Date
            data: item.data as Record<string, unknown> | undefined,
          }));

        // Keep existing comparison: check length and last message ID
        return prevMessages.length !== newMessages.length ||
          (prevMessages.length > 0 &&
            newMessages.length > 0 &&
            prevMessages[prevMessages.length - 1].id !== newMessages[newMessages.length - 1].id)
          ? newMessages
          : prevMessages;
      });

      // Process and update terminal events
      setTerminalEvents((prevTerminalEvents) => {
        const newTerminalEventsByIteration: Record<string, TerminalEvent[]> = {};
        let hasChanges = false;

        for (const item of content) {
          if (item.terminalEvent) {
            const { iterationId } = item.terminalEvent;
            if (!newTerminalEventsByIteration[iterationId]) {
              newTerminalEventsByIteration[iterationId] = [];
            }
            newTerminalEventsByIteration[iterationId].push({
              ...item.terminalEvent,
              timestamp: new Date(item.terminalEvent.timestamp).toString(),
            });
          }
        }

        const allIterationIds = new Set([
          ...Object.keys(prevTerminalEvents),
          ...Object.keys(newTerminalEventsByIteration),
        ]);
        const finalTerminalEvents = { ...prevTerminalEvents };

        for (const iterationId of allIterationIds) {
          const prevEvents = prevTerminalEvents[iterationId] || [];
          const newEvents = newTerminalEventsByIteration[iterationId] || [];

          if (
            prevEvents.length !== newEvents.length ||
            (newEvents.length > 0 &&
              prevEvents.length > 0 &&
              prevEvents[prevEvents.length - 1].id !== newEvents[newEvents.length - 1].id)
          ) {
            hasChanges = true;
            // Prune before setting
            finalTerminalEvents[iterationId] =
              newEvents.length > MAX_TERMINAL_EVENTS ? newEvents.slice(-MAX_TERMINAL_EVENTS) : newEvents;
          }
        }

        return hasChanges ? finalTerminalEvents : prevTerminalEvents;
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
      initialDataLoaded,
      conversationGraphState,
      isGraphVisualiserOpen,
      terminalEvents,
      isTerminalOpen,
      autoScrollTerminal,
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
      setConversationGraphState,
      toggleGraphVisualiser,
      toggleTerminal,
      toggleAutoScrollTerminal,
      setAutoScrollTerminal,
      clearTerminalEvents,
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
      initialDataLoaded,
      conversationGraphState,
      isGraphVisualiserOpen,
      terminalEvents,
      isTerminalOpen,
      autoScrollTerminal,
      toggleTheme,
      setCodegenOptions,
      startPolling,
      stopPolling,
      handlePauseExecution,
      handleResumeExecution,
      toggleGraphVisualiser,
      toggleTerminal,
      toggleAutoScrollTerminal,
      clearTerminalEvents,
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
