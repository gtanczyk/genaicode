import { setMaxListeners } from 'events';
import { CodegenOptions } from '../codegen-types.js';
import { handleUserInterrupt } from './user-interrupt.js';
import { setAbortController } from '../common/abort-controller.js';

// Wrapper function to run codegen in the same process
export const runCodegenWorker = async (
  options: CodegenOptions,
  waitIfPaused: () => Promise<void> = () => Promise.resolve(),
): Promise<void> => {
  console.log('Starting operation...');
  // not a top level import to avoid circular dependency
  const { runCodegenIteration } = await import('../codegen.js');
  let abortController: AbortController | null = new AbortController();
  setAbortController(abortController);
  setMaxListeners(Infinity, abortController.signal);
  const removeInterruptHandler = createInterruptHandler(abortController);

  try {
    // Set up user interrupt handling
    await Promise.race([
      runCodegenIteration(options, abortController.signal, waitIfPaused),
      handleUserInterrupt(abortController),
    ]);
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        console.log('Operation was aborted.');
      } else {
        console.error(`Error:`, error);
      }
    } else {
      console.log('Unknown error occurred', error);
    }
  } finally {
    removeInterruptHandler();
    setTimeout(() => {
      // let things finish
      setAbortController((abortController = null));
      console.log('Cleanup complete.');
    }, 100);
  }
};

// Utility function to handle interruptions with AbortSignal
const createInterruptHandler = (abortController: AbortController) => {
  const handleInterrupt = () => {
    console.log('Interrupt signal received. Aborting operation...');
    abortController.abort();
  };

  process.on('SIGINT', handleInterrupt);
  process.on('SIGTERM', handleInterrupt);

  return () => {
    process.off('SIGINT', handleInterrupt);
    process.off('SIGTERM', handleInterrupt);
  };
};
