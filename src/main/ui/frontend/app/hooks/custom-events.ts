import { useEffect } from 'react';

/**
 * Type-safe event dispatcher function
 * @param eventName - Name of the custom event
 * @param data - Optional data payload to be sent with the event
 */
export function dispatchCustomEvent<T>(eventName: string, data?: T) {
  const event = new CustomEvent(eventName, {
    bubbles: true,
    detail: data,
  });
  document.dispatchEvent(event);
}

/**
 * Custom hook for subscribing to custom events
 * @param eventName - Name of the custom event to listen for
 * @param callback - Function to be called when the event is dispatched
 */
export function useCustomEvent<T>(eventName: string, callback: (data: T) => void) {
  useEffect(() => {
    const handler = (event: Event | CustomEvent<T>) => {
      callback((event as CustomEvent).detail as T);
    };
    document.addEventListener(eventName, handler, false);
    return () => {
      document.removeEventListener(eventName, handler, false);
    };
  }, [eventName, callback]);
}
