import { useCallback } from 'react';
import { AiServiceType, CodegenOptions } from '../../../../codegen-types.js';
import {
  executeCodegen,
  getExecutionStatus,
  getCurrentQuestion,
  answerQuestion,
  interruptExecution,
  pauseExecution,
  resumeExecution,
} from '../api/api-client.js';
import { ChatMessage } from '../../../../common/content-bus-types.js';
import { Question } from '../../../common/api-types.js';

interface AppHandlersProps {
  currentPrompt: string;
  setCurrentPrompt: React.Dispatch<React.SetStateAction<string>>;
  isExecuting: boolean;
  setIsExecuting: React.Dispatch<React.SetStateAction<boolean>>;
  setExecutionStatus: React.Dispatch<React.SetStateAction<'executing' | 'idle' | 'paused'>>;
  chatMessages: ChatMessage[];
  setChatMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setCurrentQuestion: React.Dispatch<React.SetStateAction<Question | null>>;
  codegenOptions: CodegenOptions;
  setCodegenOptions: (options: CodegenOptions) => void;
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

      executeCodegen(prompt, codegenOptions, images.length > 0 ? images : undefined);
    } catch (error) {
      console.error('Failed to execute codegen:', error);
    } finally {
      setIsExecuting(false);
      setExecutionStatus('idle');
    }
  };

  const handleQuestionSubmit = async (answer: string, confirmed?: boolean, aiService?: AiServiceType) => {
    const currentQuestion = await getCurrentQuestion();
    if (currentQuestion) {
      try {
        setCurrentQuestion(null);
        await answerQuestion(currentQuestion.id, answer, confirmed, {
          ...codegenOptions,
          aiService: aiService ?? codegenOptions.aiService,
        });
      } catch (error) {
        console.error('Failed to submit answer:', error);
      }
    }
  };

  const handleInterrupt = async () => {
    try {
      setCurrentQuestion(null);
      await interruptExecution();
    } catch (error) {
      console.error('Failed to interrupt execution:', error);
    }
  };

  const handleOptionsChange = useCallback(
    (newOptions: CodegenOptions) => {
      setCodegenOptions(newOptions);
    },
    [setCodegenOptions, setChatMessages],
  );

  const handlePauseExecution = useCallback(async () => {
    try {
      await pauseExecution();
    } catch (error) {
      console.error('Failed to pause execution:', error);
    }
  }, [setExecutionStatus, setChatMessages]);

  const handleResumeExecution = useCallback(async () => {
    try {
      await resumeExecution();
    } catch (error) {
      console.error('Failed to resume execution:', error);
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
