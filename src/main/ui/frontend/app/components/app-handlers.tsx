import { useState } from 'react';
import { CodegenOptions } from '../../../../codegen-types';
import {
  executeCodegen,
  getExecutionStatus,
  getCurrentQuestion,
  answerQuestion,
  pauseExecution,
  resumeExecution,
  interruptExecution,
} from '../api/api-client';
import { ChatMessage, ChatMessageType, CodegenExecution } from '../common/types.js';

interface AppHandlersProps {
  currentPrompt: string;
  setCurrentPrompt: React.Dispatch<React.SetStateAction<string>>;
  isExecuting: boolean;
  setIsExecuting: React.Dispatch<React.SetStateAction<boolean>>;
  chatMessages: ChatMessage[];
  setChatMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  codegenExecutions: CodegenExecution[];
  setCodegenExecutions: React.Dispatch<React.SetStateAction<CodegenExecution[]>>;
  setCurrentQuestion: React.Dispatch<React.SetStateAction<{ id: string; text: string } | null>>;
  codegenOptions: CodegenOptions;
  setCodegenOptions: React.Dispatch<React.SetStateAction<CodegenOptions>>;
  fetchCodegenData: () => Promise<void>;
  fetchTotalCost: () => Promise<void>;
}

export const AppHandlers = ({
  currentPrompt,
  setCurrentPrompt,
  isExecuting,
  setIsExecuting,
  chatMessages,
  setChatMessages,
  codegenExecutions,
  setCodegenExecutions,
  setCurrentQuestion,
  codegenOptions,
  setCodegenOptions,
  fetchCodegenData,
  fetchTotalCost,
}: AppHandlersProps) => {
  const [executionAbortController, setExecutionAbortController] = useState<AbortController | null>(null);

  const handleExecute = async (prompt: string) => {
    setCurrentPrompt(prompt);
    setIsExecuting(true);
    const abortController = new AbortController();
    setExecutionAbortController(abortController);

    try {
      setChatMessages((prevMessages) => [
        ...prevMessages,
        { id: `user_${Date.now()}`, type: ChatMessageType.USER, content: prompt, timestamp: new Date() },
      ]);

      const codegenPromise = executeCodegen(prompt, codegenOptions);

      // Start checking for questions and updates
      const checkInterval = 1000; // Check every 1 second
      const checkUpdates = async () => {
        while (!abortController.signal.aborted) {
          const question = await getCurrentQuestion();
          if (question) {
            setCurrentQuestion(question);
            setChatMessages((prev) => [
              ...prev,
              {
                id: `assistant_${Date.now()}`,
                type: ChatMessageType.ASSISTANT,
                content: question.text,
                timestamp: new Date(),
              },
            ]);
            // Wait for the question to be answered
            while (!abortController.signal.aborted) {
              await new Promise((resolve) => setTimeout(resolve, checkInterval));
              const updatedQuestion = await getCurrentQuestion();
              if (!updatedQuestion || updatedQuestion.id !== question.id) {
                break; // Question has been answered or changed
              }
            }
          }
          await fetchCodegenData();
          await fetchTotalCost();
          await new Promise((resolve) => setTimeout(resolve, checkInterval));
          const status = await getExecutionStatus();
          if (status !== 'running') {
            break; // Execution has finished
          }
        }
      };

      // Run codegen and updates checking concurrently
      await Promise.all([codegenPromise, checkUpdates()]);

      // Final data fetch after execution
      await fetchCodegenData();
      await fetchTotalCost();
    } catch (error) {
      console.error('Failed to execute codegen:', error);
      setChatMessages((prev) => [
        ...prev,
        {
          id: `system_${Date.now()}`,
          type: ChatMessageType.SYSTEM,
          content: `Error: ${error.message}`,
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsExecuting(false);
      setExecutionAbortController(null);
    }
  };

  const handleQuestionSubmit = async (answer: string) => {
    const currentQuestion = await getCurrentQuestion();
    if (currentQuestion) {
      try {
        setChatMessages((prev) => [
          ...prev,
          { id: `user_${Date.now()}`, type: ChatMessageType.USER, content: answer, timestamp: new Date() },
        ]);
        await answerQuestion(currentQuestion.id, answer);
        setCurrentQuestion(null);
        await fetchCodegenData();
        await fetchTotalCost();
      } catch (error) {
        console.error('Failed to submit answer:', error);
        setChatMessages((prev) => [
          ...prev,
          {
            id: `system_${Date.now()}`,
            type: ChatMessageType.SYSTEM,
            content: `Error: ${error.message}`,
            timestamp: new Date(),
          },
        ]);
      }
    }
  };

  const handlePause = async () => {
    try {
      await pauseExecution();
      setIsExecuting(false);
      setChatMessages((prev) => [
        ...prev,
        {
          id: `system_${Date.now()}`,
          type: ChatMessageType.SYSTEM,
          content: 'Execution paused',
          timestamp: new Date(),
        },
      ]);
    } catch (error) {
      console.error('Failed to pause execution:', error);
      setChatMessages((prev) => [
        ...prev,
        {
          id: `system_${Date.now()}`,
          type: ChatMessageType.SYSTEM,
          content: `Error: ${error.message}`,
          timestamp: new Date(),
        },
      ]);
    }
  };

  const handleResume = async () => {
    try {
      await resumeExecution();
      setIsExecuting(true);
      setChatMessages((prev) => [
        ...prev,
        {
          id: `system_${Date.now()}`,
          type: ChatMessageType.SYSTEM,
          content: 'Execution resumed',
          timestamp: new Date(),
        },
      ]);
    } catch (error) {
      console.error('Failed to resume execution:', error);
      setChatMessages((prev) => [
        ...prev,
        {
          id: `system_${Date.now()}`,
          type: ChatMessageType.SYSTEM,
          content: `Error: ${error.message}`,
          timestamp: new Date(),
        },
      ]);
    }
  };

  const handleInterrupt = async () => {
    try {
      await interruptExecution();
      setIsExecuting(false);
      executionAbortController?.abort();
      setChatMessages((prev) => [
        ...prev,
        {
          id: `system_${Date.now()}`,
          type: ChatMessageType.SYSTEM,
          content: 'Execution interrupted',
          timestamp: new Date(),
        },
      ]);
    } catch (error) {
      console.error('Failed to interrupt execution:', error);
      setChatMessages((prev) => [
        ...prev,
        {
          id: `system_${Date.now()}`,
          type: ChatMessageType.SYSTEM,
          content: `Error: ${error.message}`,
          timestamp: new Date(),
        },
      ]);
    }
  };

  const handleOptionsChange = (newOptions: CodegenOptions) => {
    setCodegenOptions(newOptions);
    setChatMessages((prev) => [
      ...prev,
      {
        id: `system_${Date.now()}`,
        type: ChatMessageType.SYSTEM,
        content: 'Codegen options updated',
        timestamp: new Date(),
      },
    ]);
  };

  return {
    handleExecute,
    handleQuestionSubmit,
    handlePause,
    handleResume,
    handleInterrupt,
    handleOptionsChange,
  };
};
