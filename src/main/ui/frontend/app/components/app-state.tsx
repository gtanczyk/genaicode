import React, { useState, useEffect } from 'react';
import {
  getExecutionStatus,
  getCurrentQuestion,
  getCodegenOutput,
  getAskQuestionConversation,
  getFunctionCalls,
  getTotalCost,
  getDefaultCodegenOptions,
  getRcConfig,
} from '../api/api-client.js';
import { ChatMessage, ChatMessageType, CodegenExecution } from '../common/types.js';
import { RcConfig } from '../../../../config-lib.js';
import { CodegenOptions } from '../../../../codegen-types.js';

export const AppState = () => {
  const [currentPrompt, setCurrentPrompt] = useState('');
  const [isExecuting, setIsExecuting] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [codegenExecutions, setCodegenExecutions] = useState<CodegenExecution[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState<{ id: string; text: string } | null>(null);
  const [theme, setTheme] = useState('dark');
  const [totalCost, setTotalCost] = useState(0);
  const [codegenOptions, setCodegenOptions] = useState<CodegenOptions>({} as CodegenOptions);
  const [rcConfig, setRcConfig] = useState<RcConfig | null>(null);

  const toggleTheme = () => {
    setTheme(theme === 'light' ? 'dark' : 'light');
  };

  useEffect(() => {
    fetchInitialData();
  }, []);

  const fetchInitialData = async () => {
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
  };

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
      const [output, conversation, calls] = await Promise.all([
        getCodegenOutput(),
        getAskQuestionConversation(),
        getFunctionCalls(),
      ]);

      const newMessages: ChatMessage[] = [
        ...conversation.map((item, index) => ({
          id: `conv_${index}`,
          type: index % 2 === 0 ? ChatMessageType.ASSISTANT : ChatMessageType.USER,
          content: item.question || item.answer,
          timestamp: new Date(),
        })),
        ...calls.map((call, index) => ({
          id: `call_${index}`,
          type: ChatMessageType.SYSTEM,
          content: `Function called: ${call.name} with args: ${JSON.stringify(call.args)}`,
          timestamp: new Date(),
        })),
      ];

      setChatMessages((prevMessages) => [...prevMessages, ...newMessages]);

      if (output) {
        setCodegenExecutions((prevExecutions) => [
          ...prevExecutions,
          {
            id: `exec_${prevExecutions.length}`,
            prompt: currentPrompt,
            output,
            timestamp: new Date(),
            cost: 0, // You might want to update this with the actual cost if available
          },
        ]);
      }
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

  const handlePromptSubmit = async (prompt: string) => {
    setCurrentPrompt(prompt);
    setChatMessages((prevMessages) => [
      ...prevMessages,
      { id: `user_${Date.now()}`, type: ChatMessageType.USER, content: prompt, timestamp: new Date() },
    ]);
    setIsExecuting(true);
    // Here you would typically call your API to execute the codegen
    // After execution, you would update the state with the results
    // For now, we'll just add a placeholder assistant message
    setTimeout(() => {
      setChatMessages((prevMessages) => [
        ...prevMessages,
        {
          id: `assistant_${Date.now()}`,
          type: ChatMessageType.ASSISTANT,
          content: 'Codegen execution completed.',
          timestamp: new Date(),
        },
      ]);
      setIsExecuting(false);
    }, 2000);
  };

  const handleQuestionSubmit = async (answer: string) => {
    if (currentQuestion) {
      setChatMessages((prevMessages) => [
        ...prevMessages,
        { id: `user_answer_${Date.now()}`, type: ChatMessageType.USER, content: answer, timestamp: new Date() },
      ]);
      setCurrentQuestion(null);
      // Here you would typically send the answer to your API
      // and then update the state based on the response
    }
  };

  return {
    currentPrompt,
    setCurrentPrompt,
    setChatMessages,
    isExecuting,
    setIsExecuting,
    chatMessages,
    codegenExecutions,
    currentQuestion,
    setCodegenExecutions,
    setCurrentQuestion,
    theme,
    totalCost,
    codegenOptions,
    setCodegenOptions,
    rcConfig,
    toggleTheme,
    handlePromptSubmit,
    handleQuestionSubmit,
    checkExecutionStatus,
    checkCurrentQuestion,
    fetchCodegenData,
    fetchTotalCost,
  };
};
