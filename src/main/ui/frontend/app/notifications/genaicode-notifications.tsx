import { useEffect, useRef, useState } from 'react';
import { ChatMessage } from '../../../../common/content-bus-types.js';
import { soundEngine } from '../sounds/sound-engine.js';

interface GenAIcodeNotificationsProps {
  messages: ChatMessage[];
  muteNotifications?: boolean;
}

/**
 * Component that handles both sound and title notifications for new messages
 * when the window is not focused.
 * - Updates browser tab title with unread message count
 * - Plays sound notifications (when unmuted)
 * - Resets notifications when window gains focus
 * - Stops sound when window gains focus
 */
export const GenAIcodeNotifications: React.FC<GenAIcodeNotificationsProps> = ({ 
  messages,
  muteNotifications = false 
}) => {
  const lastMessageCountRef = useRef(messages.length);
  const isWindowFocusedRef = useRef(document.hasFocus());
  const originalTitle = useRef(document.title);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    // Save original title on mount
    originalTitle.current = document.title;
    
    return () => {
      // Restore original title on unmount
      document.title = originalTitle.current;
    };
  }, []);

  useEffect(() => {
    // Handle window focus changes
    const handleFocusChange = () => {
      const isFocused = document.hasFocus();
      isWindowFocusedRef.current = isFocused;
      
      if (isFocused) {
        // Reset unread count and restore title when window gains focus
        setUnreadCount(0);
        document.title = originalTitle.current;
        
        // Stop the bark sound if there were unread messages
        if (unreadCount > 0) {
          soundEngine.stop();
        }
      }
    };

    window.addEventListener('focus', handleFocusChange);
    window.addEventListener('blur', handleFocusChange);

    return () => {
      window.removeEventListener('focus', handleFocusChange);
      window.removeEventListener('blur', handleFocusChange);
    };
  }, [unreadCount]);

  useEffect(() => {
    // Check for new messages
    if (messages.length > lastMessageCountRef.current) {
      // Only notify if window is not focused
      if (!isWindowFocusedRef.current) {
        // Update unread count and title
        const newUnreadCount = unreadCount + (messages.length - lastMessageCountRef.current);
        setUnreadCount(newUnreadCount);
        document.title = `(${newUnreadCount}) ${originalTitle.current}`;

        // Play sound if not muted
        if (!muteNotifications) {
          soundEngine.playBark(0.5);
        }
      }
    }
    lastMessageCountRef.current = messages.length;
  }, [messages, unreadCount, muteNotifications]);

  // This component doesn't render anything
  return null;
};