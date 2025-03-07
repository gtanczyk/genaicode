import { useState, useEffect, useCallback, useRef } from 'react';
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
import { Question, Usage } from '../../../common/api-types.js';
import { ChatMessage } from '../../../../common/content-bus-types.js';
import { RcConfig } from '../../../../config-types.js';
import { CodegenOptions } from '../../../../codegen-types.js';

type ExecutionStatus = 'idle' | 'executing' | 'paused';

const POLLING_INTERVAL = 500; // 0.5 seconds

export const AppState = () => {
  const [currentPrompt, setCurrentPrompt] = useState('');
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionStatus, setExecutionStatus] = useState<ExecutionStatus>('idle');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null);
  const [theme, setTheme] = useState('dark');
  const [usage, setUsage] = useState<Usage>();
  const [codegenOptions, setCodegenOptions] = useState<CodegenOptions>({} as CodegenOptions);
  const [rcConfig, setRcConfig] = useState<RcConfig | null>(null);
  const [lastFinishedExecutionId, setLastFinishedExecutionId] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const pollingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const toggleTheme = () => {
    setTheme(theme === 'light' ? 'dark' : 'light');
  };

  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        const [status, question, content, usage, defaultOptions, config] = await Promise.all([
          getExecutionStatus(),
          getCurrentQuestion(),
          getContent(),
          getUsage(),
          getDefaultCodegenOptions(),
          getRcConfig(),
        ]);

        setIsExecuting(status !== 'idle');
        setExecutionStatus(status);
        setCurrentQuestion(question);
        setChatMessages(
          content
            .filter((content) => !!content.message)
            .map((content) => ({
              ...content.message!,
              data: content.data,
            })),
        );
        setUsage(usage);
        setCodegenOptions(defaultOptions);
        setRcConfig(config);
      } catch (error) {
        console.error('Failed to fetch initial data:', error);
      }
    };

    fetchInitialData();
  }, []);

  const startPolling = useCallback(() => {
    if (!isPolling) {
      setIsPolling(true);
      const poll = async () => {
        try {
          const [status, question, content, usage] = await Promise.all([
            getExecutionStatus(),
            getCurrentQuestion(),
            getContent(),
            getUsage(),
          ]);

          setIsExecuting(status !== 'idle');
          setExecutionStatus(status);
          setCurrentQuestion(question);
          setChatMessages(
            content
              .filter((content) => !!content.message)
              .map((content) => ({
                ...content.message!,
                data: content.data,
              })),
          );
          setUsage(usage);
        } catch (error) {
          console.error('Failed to poll data:', error);
        }
        pollingTimeoutRef.current = setTimeout(poll, POLLING_INTERVAL);
      };
      poll();
    }
  }, [isPolling]);

  const stopPolling = useCallback(() => {
    if (isPolling) {
      setIsPolling(false);
      if (pollingTimeoutRef.current) {
        clearTimeout(pollingTimeoutRef.current);
        pollingTimeoutRef.current = null;
      }
    }
  }, [isPolling]);

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

  return {
    currentPrompt,
    setCurrentPrompt,
    isExecuting,
    setIsExecuting,
    executionStatus,
    setExecutionStatus,
    chatMessages,
    setChatMessages,
    currentQuestion,
    theme,
    usage,
    codegenOptions,
    rcConfig,
    lastFinishedExecutionId,
    toggleTheme,
    setCodegenOptions,
    setCurrentQuestion,
    setLastFinishedExecutionId,
    startPolling,
    stopPolling,
    handlePauseExecution,
    handleResumeExecution,
  };
};
