import React, { useState, useEffect, useCallback } from 'react';
import {
  getExecutionStatus,
  getCurrentQuestion,
  getTotalCost,
  getDefaultCodegenOptions,
  getRcConfig,
  getContent,
} from '../api/api-client.js';
import { ChatMessage, ChatMessageType } from '../../../../common/content-bus-types.js';
import { RcConfig } from '../../../../config-lib.js';
import { CodegenOptions } from '../../../../codegen-types.js';

export const AppState = () => {
  const [currentPrompt, setCurrentPrompt] = useState('');
  const [isExecuting, setIsExecuting] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState<{ id: string; text: string } | null>(null);
  const [theme, setTheme] = useState('dark');
  const [totalCost, setTotalCost] = useState(0);
  const [codegenOptions, setCodegenOptions] = useState<CodegenOptions>({} as CodegenOptions);
  const [rcConfig, setRcConfig] = useState<RcConfig | null>(null);

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
      setIsExecuting(status === 'running');
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

      setChatMessages(content.filter((content) => !!content.message).map((content) => content.message!));
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
      // Here you would typically call your API to execute the codegen
      // After execution, you would update the state with the results
      // For now, we'll just add a placeholder assistant message
      setTimeout(() => {
        addChatMessage({
          id: `assistant_${Date.now()}`,
          type: ChatMessageType.ASSISTANT,
          content: 'Codegen execution completed.',
          timestamp: new Date(),
        });
        setIsExecuting(false);
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

  return {
    currentPrompt,
    setCurrentPrompt,
    isExecuting,
    setIsExecuting,
    chatMessages,
    setChatMessages,
    currentQuestion,
    theme,
    totalCost,
    codegenOptions,
    rcConfig,
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
  };
};
