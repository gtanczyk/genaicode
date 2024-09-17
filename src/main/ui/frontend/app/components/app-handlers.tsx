import { useState, useCallback } from 'react';
import { CodegenOptions } from '../../../../codegen-types.js';
import {
  executeCodegen,
  getExecutionStatus,
  getCurrentQuestion,
  answerQuestion,
  pauseExecution,
  resumeExecution,
  interruptExecution,
} from '../api/api-client.js';
import { ChatMessage, ChatMessageType } from '../../../../common/content-bus-types.js';

interface AppHandlersProps {
  currentPrompt: string;
  setCurrentPrompt: React.Dispatch<React.SetStateAction<string>>;
  isExecuting: boolean;
  setIsExecuting: React.Dispatch<React.SetStateAction<boolean>>;
  chatMessages: ChatMessage[];
  setChatMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setCurrentQuestion: React.Dispatch<
    React.SetStateAction<{ id: string; text: string; isConfirmation: boolean } | null>
  >;
  codegenOptions: CodegenOptions;
  setCodegenOptions: (options: CodegenOptions) => void;
  fetchCodegenData: () => Promise<void>;
  fetchTotalCost: () => Promise<void>;
  setLastFinishedExecutionId: React.Dispatch<React.SetStateAction<string | null>>;
}

export const AppHandlers = ({
  setCurrentPrompt,
  setIsExecuting,
  setChatMessages,
  setCurrentQuestion,
  codegenOptions,
  setCodegenOptions,
  fetchCodegenData,
  fetchTotalCost,
  setLastFinishedExecutionId,
}: AppHandlersProps) => {
  const [executionAbortController, setExecutionAbortController] = useState<AbortController | null>(null);
  const [isCodegenOngoing, setIsCodegenOngoing] = useState(false);

  const handleExecute = async (prompt: string) => {
    setCurrentPrompt(prompt);
    setIsExecuting(true);
    setIsCodegenOngoing(true);
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

      // Mark the execution as finished
      const finishedExecutionId = `execution_${Date.now()}`;
      setLastFinishedExecutionId(finishedExecutionId);
      setChatMessages((prev) => [
        ...prev,
        {
          id: finishedExecutionId,
          type: ChatMessageType.SYSTEM,
          content: 'Codegen execution completed.',
          timestamp: new Date(),
        },
      ]);
    } catch (error) {
      console.error('Failed to execute codegen:', error);
      setChatMessages((prev) => [
        ...prev,
        {
          id: `system_${Date.now()}`,
          type: ChatMessageType.SYSTEM,
          content: `Error: ${error}`,
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsExecuting(false);
      setIsCodegenOngoing(false);
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

        // Add indicator for ongoing code execution
        setChatMessages((prev) => [
          ...prev,
          {
            id: `system_${Date.now()}`,
            type: ChatMessageType.SYSTEM,
            content: 'Continuing code execution...',
            timestamp: new Date(),
          },
        ]);

        setIsCodegenOngoing(true);
      } catch (error) {
        console.error('Failed to submit answer:', error);
        setChatMessages((prev) => [
          ...prev,
          {
            id: `system_${Date.now()}`,
            type: ChatMessageType.SYSTEM,
            content: `Error: ${error}`,
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
          content: `Error: ${error}`,
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
          content: `Error: ${error}`,
          timestamp: new Date(),
        },
      ]);
    }
  };

  const handleInterrupt = async () => {
    try {
      await interruptExecution();
      setIsExecuting(false);
      setIsCodegenOngoing(false);
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
          content: `Error: ${error}`,
          timestamp: new Date(),
        },
      ]);
    }
  };

  const handleOptionsChange = useCallback(
    (newOptions: CodegenOptions) => {
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
    },
    [setCodegenOptions, setChatMessages],
  );

  return {
    handleExecute,
    handleQuestionSubmit,
    handlePause,
    handleResume,
    handleInterrupt,
    handleOptionsChange,
    isCodegenOngoing,
  };
};
