import { useCallback, useContext } from 'react';
import { AiServiceType, CodegenOptions } from '../../../../codegen-types.js';
import {
  executeCodegen,
  getExecutionStatus,
  getCurrentQuestion,
  answerQuestion,
  interruptExecution,
} from '../api/api-client.js';
import { ChatStateContext } from '../contexts/chat-state-context.js'; // Import the context
import { StructuredQuestionResponse } from '../../../../../prompt/steps/step-ask-question/step-ask-question-types.js';

// Remove props related to state setters, they will come from context
interface AppHandlersProps {
  codegenOptions: CodegenOptions | undefined; // Receive options directly
}

export const AppHandlers = ({ codegenOptions }: AppHandlersProps) => {
  // Consume the context to get state and setters
  const {
    setCurrentPrompt,
    setExecutionStatus,
    setCurrentQuestion,
    setCodegenOptions,
    handlePauseExecution: contextHandlePause,
    handleResumeExecution: contextHandleResume,
  } = useContext(ChatStateContext);

  const handleExecute = async (prompt: string, images: File[]) => {
    // Use setters from context
    setCurrentPrompt(prompt);
    setExecutionStatus('executing');

    try {
      if ((await getExecutionStatus()) === 'executing') {
        console.warn('Execution is already executing');
        // Even if executing, update status for consistency if needed, though API call might handle this
        setExecutionStatus('executing');
        return;
      }

      // Ensure codegenOptions is defined before using
      if (!codegenOptions) {
        console.error('Codegen options not available');
        setExecutionStatus('idle');
        return;
      }

      // Execute codegen API call
      await executeCodegen(prompt, codegenOptions, images.length > 0 ? images : undefined);
      setCodegenOptions({ ...codegenOptions, initialActionType: undefined }); // Clear initial action type after execution
      // Polling in ChatStateContext should update the status, but set to executing optimistically
      setExecutionStatus('executing');
    } catch (error) {
      console.error('Failed to execute codegen:', error);
      setExecutionStatus('idle'); // Reset status on error
    }
    // Removed finally block that set status to idle, polling handles final state
  };

  const handleQuestionSubmit = async (
    answer: string,
    images?: File[],
    confirmed?: boolean,
    aiService?: AiServiceType,
    selectedActionType?: string,
    structuredResponse?: StructuredQuestionResponse,
  ) => {
    // Fetch current question directly if needed, though context might already have it
    const currentQuestionFromContext = await getCurrentQuestion(); // Or use context.currentQuestion
    if (currentQuestionFromContext) {
      try {
        // Use setters from context
        setCurrentQuestion(null);
        if (codegenOptions) {
          const updatedOptions = { ...codegenOptions, aiService: aiService ?? codegenOptions.aiService };
          setCodegenOptions(updatedOptions);
          // Forward optional manual action selection parameters to backend.
          await answerQuestion(
            currentQuestionFromContext.id,
            answer,
            confirmed,
            updatedOptions,
            images,
            selectedActionType,
            structuredResponse,
          );
        } else {
          console.error('Codegen options not available for submitting answer');
        }
      } catch (error) {
        console.error('Failed to submit answer:', error);
        // Restore question if submission fails? Or let polling handle it?
        setCurrentQuestion(currentQuestionFromContext);
      }
    }
  };

  const handleInterrupt = async () => {
    try {
      // Use setter from context
      setCurrentQuestion(null);
      await interruptExecution();
      // Polling will update status to idle
    } catch (error) {
      console.error('Failed to interrupt execution:', error);
    }
  };

  // Options change is handled directly by setCodegenOptions from context where needed (e.g., modals)
  // This specific handler might become redundant if options are only changed via modals/context setters
  const handleOptionsChange = useCallback(
    (newOptions: CodegenOptions) => {
      setCodegenOptions(newOptions);
    },
    [setCodegenOptions], // Dependency on the setter from context
  );

  // Use the pause/resume handlers directly from context
  const handlePauseExecution = contextHandlePause;
  const handleResumeExecution = contextHandleResume;

  return {
    handleExecute,
    handleQuestionSubmit,
    handleInterrupt,
    handleOptionsChange, // Keep if still needed externally
    handlePauseExecution,
    handleResumeExecution,
  };
};
