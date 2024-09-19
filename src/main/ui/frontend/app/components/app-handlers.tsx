import { useCallback } from 'react';
import { CodegenOptions } from '../../../../codegen-types.js';
import {
  executeCodegen,
  executeMultimodalCodegen,
  getExecutionStatus,
  getCurrentQuestion,
  answerQuestion,
  interruptExecution,
  pauseExecution,
  resumeExecution,
} from '../api/api-client.js';
import { ChatMessage, ChatMessageType } from '../../../../common/content-bus-types.js';

interface AppHandlersProps {
  currentPrompt: string;
  setCurrentPrompt: React.Dispatch<React.SetStateAction<string>>;
  isExecuting: boolean;
  setIsExecuting: React.Dispatch<React.SetStateAction<boolean>>;
  setExecutionStatus: React.Dispatch<React.SetStateAction<'executing' | 'idle' | 'paused'>>;
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
  setExecutionStatus,
  setChatMessages,
  setCurrentQuestion,
  codegenOptions,
  setCodegenOptions,
}: AppHandlersProps) => {
  const handleExecute = async (prompt: string, images: File[]) => {
    setCurrentPrompt(prompt);
    setIsExecuting(true);

    try {
      setIsExecuting(true);
      setExecutionStatus('executing');

      if ((await getExecutionStatus()) === 'executing') {
        console.warn('Execution is already executing');
        return;
      }

      if (images.length > 0) {
        executeMultimodalCodegen(prompt, images, codegenOptions);
      } else {
        executeCodegen(prompt, codegenOptions);
      }
    } catch (error) {
      console.error('Failed to execute codegen:', error);
    } finally {
      setIsExecuting(false);
      setExecutionStatus('idle');
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
      } catch (error) {
        console.error('Failed to submit answer:', error);
      }
    }
  };

  const handleInterrupt = async () => {
    try {
      await interruptExecution();
      setIsExecuting(false);
      setExecutionStatus('idle');
      setCurrentQuestion(null);
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
          content: `Error interrupting execution: ${error}`,
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

  const handlePauseExecution = useCallback(async () => {
    try {
      await pauseExecution();
      setExecutionStatus('paused');
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
          content: `Error pausing execution: ${error}`,
          timestamp: new Date(),
        },
      ]);
    }
  }, [setExecutionStatus, setChatMessages]);

  const handleResumeExecution = useCallback(async () => {
    try {
      await resumeExecution();
      setExecutionStatus('executing');
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
          content: `Error resuming execution: ${error}`,
          timestamp: new Date(),
        },
      ]);
    }
  }, [setExecutionStatus, setChatMessages]);

  return {
    handleExecute,
    handleQuestionSubmit,
    handleInterrupt,
    handleOptionsChange,
    handlePauseExecution,
    handleResumeExecution,
  };
};
