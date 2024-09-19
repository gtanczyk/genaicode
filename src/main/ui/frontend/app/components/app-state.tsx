import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getExecutionStatus,
  getCurrentQuestion,
  getTotalCost,
  getDefaultCodegenOptions,
  getRcConfig,
  getContent,
  pauseExecution,
  resumeExecution,
} from '../api/api-client.js';
import { ChatMessage, ChatMessageType } from '../../../../common/content-bus-types.js';
import { RcConfig } from '../../../../config-lib.js';
import { CodegenOptions } from '../../../../codegen-types.js';

export type ExecutionStatus = 'idle' | 'executing' | 'paused';

const POLLING_INTERVAL = 500; // 0.5 seconds

export const AppState = () => {
  const [currentPrompt, setCurrentPrompt] = useState('');
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionStatus, setExecutionStatus] = useState<ExecutionStatus>('idle');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState<{ id: string; text: string; isConfirmation: boolean } | null>(
    null,
  );
  const [theme, setTheme] = useState('dark');
  const [totalCost, setTotalCost] = useState(0);
  const [codegenOptions, setCodegenOptions] = useState<CodegenOptions>({} as CodegenOptions);
  const [rcConfig, setRcConfig] = useState<RcConfig | null>(null);
  const [visibleDataIds, setVisibleDataIds] = useState<Set<string>>(new Set());
  const [lastFinishedExecutionId, setLastFinishedExecutionId] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const pollingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const toggleTheme = () => {
    setTheme(theme === 'light' ? 'dark' : 'light');
  };

  const fetchInitialData = useCallback(async () => {
    try {
      await Promise.all([
        checkExecutionStatus(),
        checkCurrentQuestion(),
        fetchCodegenData(),
        fetchTotalCost(),
        fetchDefaultCodegenOptions(),
        fetchRcConfig(),
      ]);
    } catch (error) {
      console.error('Failed to fetch initial data:', error);
    }
  }, []);

  useEffect(() => {
    fetchInitialData();
  }, [fetchInitialData]);

  const checkExecutionStatus = async () => {
    try {
      const status = await getExecutionStatus();
      setIsExecuting(status !== 'idle');
      setExecutionStatus(status);
    } catch (error) {
      console.error('Failed to check execution status:', error);
    }
  };

  const checkCurrentQuestion = async () => {
    try {
      const question = await getCurrentQuestion();
      setCurrentQuestion(question);
    } catch (error) {
      console.error('Failed to fetch current question:', error);
    }
  };

  const fetchCodegenData = async () => {
    try {
      const content = await getContent();

      setChatMessages(
        content
          .filter((content) => !!content.message)
          .map((content) => ({
            ...content.message!,
            data: content.data,
          })),
      );
    } catch (error) {
      console.error('Failed to fetch codegen data:', error);
    }
  };

  const fetchTotalCost = async () => {
    try {
      const cost = await getTotalCost();
      setTotalCost(cost);
    } catch (error) {
      console.error('Failed to fetch total cost:', error);
    }
  };

  const fetchDefaultCodegenOptions = async () => {
    try {
      const defaultOptions = await getDefaultCodegenOptions();
      setCodegenOptions(defaultOptions);
    } catch (error) {
      console.error('Failed to fetch default codegen options:', error);
    }
  };

  const fetchRcConfig = async () => {
    try {
      const config = await getRcConfig();
      setRcConfig(config);
    } catch (error) {
      console.error('Failed to fetch rcConfig:', error);
    }
  };

  const addChatMessage = useCallback((message: ChatMessage) => {
    setChatMessages((prevMessages) => [...prevMessages, message]);
  }, []);

  const handlePromptSubmit = useCallback(
    async (prompt: string) => {
      setCurrentPrompt(prompt);
      addChatMessage({
        id: `user_${Date.now()}`,
        type: ChatMessageType.USER,
        content: prompt,
        timestamp: new Date(),
      });
      setIsExecuting(true);
      setExecutionStatus('executing');
      // Here you would typically call your API to execute the codegen
      // After execution, you would update the state with the results
      // For now, we'll just add a placeholder assistant message
      setTimeout(() => {
        const executionId = `execution_${Date.now()}`;
        addChatMessage({
          id: executionId,
          type: ChatMessageType.ASSISTANT,
          content: 'Codegen execution completed.',
          timestamp: new Date(),
        });
        setIsExecuting(false);
        setExecutionStatus('idle');
        setLastFinishedExecutionId(executionId);
      }, 2000);
    },
    [addChatMessage],
  );

  const handleQuestionSubmit = useCallback(
    async (answer: string) => {
      if (currentQuestion) {
        addChatMessage({
          id: `user_answer_${Date.now()}`,
          type: ChatMessageType.USER,
          content: answer,
          timestamp: new Date(),
        });
        setCurrentQuestion(null);
        // Here you would typically send the answer to your API
        // and then update the state based on the response
      }
    },
    [currentQuestion, addChatMessage],
  );

  const updateCodegenOptions = useCallback(
    (newOptions: CodegenOptions) => {
      setCodegenOptions(newOptions);
      addChatMessage({
        id: `system_${Date.now()}`,
        type: ChatMessageType.SYSTEM,
        content: 'Codegen options updated',
        timestamp: new Date(),
      });
    },
    [addChatMessage],
  );

  const toggleDataVisibility = useCallback((id: string) => {
    setVisibleDataIds((prevIds) => {
      const newIds = new Set(prevIds);
      if (newIds.has(id)) {
        newIds.delete(id);
      } else {
        newIds.add(id);
      }
      return newIds;
    });
  }, []);

  const startPolling = useCallback(() => {
    if (!isPolling) {
      setIsPolling(true);
      const poll = async () => {
        await Promise.all([checkExecutionStatus(), checkCurrentQuestion(), fetchCodegenData(), fetchTotalCost()]);
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
      addChatMessage({
        id: `system_${Date.now()}`,
        type: ChatMessageType.SYSTEM,
        content: 'Execution paused',
        timestamp: new Date(),
      });
    } catch (error) {
      console.error('Failed to pause execution:', error);
    }
  }, [addChatMessage]);

  const handleResumeExecution = useCallback(async () => {
    try {
      await resumeExecution();
      setExecutionStatus('executing');
      addChatMessage({
        id: `system_${Date.now()}`,
        type: ChatMessageType.SYSTEM,
        content: 'Execution resumed',
        timestamp: new Date(),
      });
    } catch (error) {
      console.error('Failed to resume execution:', error);
    }
  }, [addChatMessage]);

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
    totalCost,
    codegenOptions,
    rcConfig,
    visibleDataIds,
    lastFinishedExecutionId,
    toggleTheme,
    checkExecutionStatus,
    checkCurrentQuestion,
    fetchCodegenData,
    fetchTotalCost,
    handlePromptSubmit,
    handleQuestionSubmit,
    addChatMessage,
    setCodegenOptions,
    setCurrentQuestion,
    updateCodegenOptions,
    toggleDataVisibility,
    setLastFinishedExecutionId,
    startPolling,
    stopPolling,
    isPolling,
    handlePauseExecution,
    handleResumeExecution,
  };
};
