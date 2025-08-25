import { putContainerLog } from '../../../../../../main/common/content-bus.js';

let interruptionController = new AbortController();

/**
 * Requests an interrupt for the current container command.
 * @returns An object indicating whether the interrupt request was accepted.
 */
export function requestInterrupt(): { accepted: boolean } {
  putContainerLog('warn', `User requested to interrupt current command.`);

  interruptionController.abort();

  return { accepted: true };
}

/**
 * Sets a listener for when an interrupt is requested.
 * @param fn The function to call when an interrupt is requested.
 * @returns A function to remove the listener.
 */
export function onInterruptRequested(fn: () => void): () => void {
  interruptionController.signal.addEventListener('abort', fn);
  return () => {
    interruptionController.signal.removeEventListener('abort', fn);
  };
}

/**
 * Checks if an interrupt has been requested.
 * @returns True if an interrupt has been requested, false otherwise.
 */
export function isInterrupted(): boolean {
  return interruptionController.signal.aborted;
}

export function clearInterruption(): void {
  interruptionController = new AbortController();
}
