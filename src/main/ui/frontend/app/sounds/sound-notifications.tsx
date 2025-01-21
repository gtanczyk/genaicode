import { useEffect, useRef } from 'react';
import { ChatMessage } from '../../../../common/content-bus-types.js';
import { soundEngine } from './sound-engine.js';

interface SoundNotificationsProps {
  messages: ChatMessage[];
}

/**
 * Component that handles sound notifications for new messages
 * when the window is not focused
 */
export const SoundNotifications: React.FC<SoundNotificationsProps> = ({ messages }) => {
  const lastMessageCountRef = useRef(messages.length);
  const isWindowFocusedRef = useRef(document.hasFocus());

  useEffect(() => {
    // Update focus state when window focus changes
    const handleFocusChange = () => {
      isWindowFocusedRef.current = document.hasFocus();
    };

    window.addEventListener('focus', handleFocusChange);
    window.addEventListener('blur', handleFocusChange);

    return () => {
      window.removeEventListener('focus', handleFocusChange);
      window.removeEventListener('blur', handleFocusChange);
    };
  }, []);

  useEffect(() => {
    // Check if there are new messages
    if (messages.length > lastMessageCountRef.current) {
      // Play sound only if window is not focused
      if (!isWindowFocusedRef.current) {
        soundEngine.playBark(0.5);
      }
    }
    lastMessageCountRef.current = messages.length;
  }, [messages]);

  // This component doesn't render anything
  return null;
};
