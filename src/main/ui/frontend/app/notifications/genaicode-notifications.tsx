import { useEffect, useRef, useState } from 'react';
import { ChatMessage } from '../../../../common/content-bus-types.js';
import { NotificationEventType, NotificationEvent } from '../../../../../vite-genaicode/vite-genaicode-types.js';
import { soundEngine } from '../sounds/sound-engine.js';
import { Question } from '../../../common/api-types.js';

interface GenAIcodeNotificationsProps {
  messages: ChatMessage[];
  currentQuestion: Question | null;
  muteNotifications?: boolean;
}

/**
 * Component that handles notifications for GenAIcode in both first-party and iframe contexts.
 *
 * Features:
 * - First-party context:
 *   - Updates browser tab title with unread message count
 *   - Plays sound notifications (when unmuted)
 *   - Resets notifications when window gains focus
 *
 * - Iframe context:
 *   - Uses postMessage to communicate with parent window
 *   - Sends notifications about new messages
 *   - Handles focus state through cross-window communication
 */
export const GenAIcodeNotifications: React.FC<GenAIcodeNotificationsProps> = ({
  currentQuestion,
  messages,
  muteNotifications = false,
}) => {
  const lastQuestionIdRef = useRef<string | null>(currentQuestion?.id ?? null);
  const lastMessageCountRef = useRef(messages.length);
  const isWindowFocusedRef = useRef(document.hasFocus());
  const originalTitle = useRef(document.title);
  const [unreadCount, setUnreadCount] = useState(0);
  const isInIframe = window !== window.parent;

  // Save original title on mount
  useEffect(() => {
    originalTitle.current = document.title;
    return () => {
      document.title = originalTitle.current;
    };
  }, []);

  // Send message to parent window
  const notifyParent = (event: NotificationEvent) => {
    if (isInIframe && window.parent) {
      // Ensure the event is marked as coming from GenAIcode
      const secureEvent: NotificationEvent = {
        ...event,
        source: 'genaicode',
        origin: window.location.origin,
      };
      window.parent.postMessage(secureEvent, '*');
    }
  };

  // Handle focus changes
  useEffect(() => {
    const handleFocusChange = () => {
      const isFocused = document.hasFocus() && document.visibilityState === 'visible';
      isWindowFocusedRef.current = isFocused;

      if (isInIframe) {
        // Notify parent window about focus change
        notifyParent({
          type: isFocused ? NotificationEventType.FOCUS : NotificationEventType.BLUR,
          payload: { isFocused, timestamp: Date.now() },
        });
      } else {
        // First-party context: handle focus change locally
        if (isFocused) {
          document.title = originalTitle.current;
        }
      }

      if (isFocused) {
        setUnreadCount(0);
        document.title = originalTitle.current;
        soundEngine.stop();
      }
    };

    // Setup focus/blur listeners
    window.addEventListener('focus', handleFocusChange);
    window.addEventListener('blur', handleFocusChange);
    document.addEventListener('visibilitychange', handleFocusChange, false);

    // Initial focus state notification for iframe context
    if (isInIframe) {
      handleFocusChange();
    }

    return () => {
      window.removeEventListener('focus', handleFocusChange);
      window.removeEventListener('blur', handleFocusChange);
      document.removeEventListener('visibilitychange', handleFocusChange, false);
    };
  }, []);

  // Handle incoming messages from parent window
  useEffect(() => {
    if (!isInIframe) return;

    const handleMessage = (event: MessageEvent) => {
      // Verify the message is from our parent window
      if (event.source !== window.parent) return;

      try {
        const { type, source } = event.data as NotificationEvent;
        if (source !== 'genaicode') return;

        switch (type) {
          case NotificationEventType.RESET_NOTIFICATIONS:
            setUnreadCount(0);
            soundEngine.stop();
            break;
        }
      } catch (error) {
        console.warn('Error handling notification message:', error);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Handle new messages
  useEffect(() => {
    if (messages.length > lastMessageCountRef.current) {
      const newMessagesCount = messages.length - lastMessageCountRef.current;

      if (isInIframe) {
        // Iframe context: notify parent about new messages
        notifyParent({
          type: NotificationEventType.NEW_MESSAGES,
          payload: {
            count: newMessagesCount,
            timestamp: Date.now(),
          },
        });
      } else if (!isWindowFocusedRef.current) {
        // First-party context: update title and play sound
        const newUnreadCount = unreadCount + newMessagesCount;
        setUnreadCount(newUnreadCount);
        
        const displayCount = newUnreadCount > 99 ? '99+' : newUnreadCount;
        document.title = `(${displayCount}) ${originalTitle.current}`;
      }
    }
    
    // Update ref to current length to avoid accumulation errors
    lastMessageCountRef.current = messages.length;
  }, [messages, unreadCount]);

  // Handle new questions (play sound)
  useEffect(() => {
    if (currentQuestion && currentQuestion.id !== lastQuestionIdRef.current) {
      if (!isWindowFocusedRef.current && !muteNotifications) {
        soundEngine.playBark(0.5);
      }
      lastQuestionIdRef.current = currentQuestion.id;
    } else if (!currentQuestion) {
      lastQuestionIdRef.current = null;
    }
  }, [currentQuestion, muteNotifications]);

  // This component doesn't render anything
  return null;
};
