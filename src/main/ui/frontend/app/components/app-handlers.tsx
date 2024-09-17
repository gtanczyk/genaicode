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
}: AppHandlersProps) => {
  const [isCodegenOngoing, setIsCodegenOngoing] = useState(false);

  const handleExecute = async (prompt: string) => {
    setCurrentPrompt(prompt);
    setIsExecuting(true);
    setIsCodegenOngoing(true);

    try {
      if ((await getExecutionStatus()) === 'running') {
        console.warn('Execution is already running');
        return;
      }

      executeCodegen(prompt, codegenOptions);
    } catch (error) {
      console.error('Failed to execute codegen:', error);
    } finally {
      setIsExecuting(false);
      setIsCodegenOngoing(false);
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
        setIsCodegenOngoing(true);
      } catch (error) {
        console.error('Failed to submit answer:', error);
      }
    }
  };

  const handlePause = async () => {
    try {
      await pauseExecution();
      setIsExecuting(false);
    } catch (error) {
      console.error('Failed to pause execution:', error);
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
    } catch (error) {
      console.error('Failed to interrupt execution:', error);
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
