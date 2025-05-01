import { useEffect, useContext } from 'react';
import { ChatStateContext } from '../../contexts/chat-state-context';
import { ChatMessage, ChatMessageType } from '../../../../../common/content-bus-types';
import { ConversationGraphState } from '../../../../common/api-types';

// Helper function to find the latest graph state embedded in system messages
const findLatestGraphState = (messages: ChatMessage[]): ConversationGraphState | null => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    // Check if it's a system message and has the graph state data
    if (message.type === ChatMessageType.SYSTEM && message.data?.conversationGraphState) {
      // TODO: Consider adding more robust type checking/validation for message.data.conversationGraphState
      return message.data.conversationGraphState as ConversationGraphState;
    }
  }
  return null; // No graph state found in messages
};

/**
 * A non-rendering component responsible for observing chat messages
 * and updating the conversation graph state in the ChatStateContext.
 */
export const ConversationGraphStateHandler: React.FC = () => {
  const { messages, setConversationGraphState } = useContext(ChatStateContext);

  useEffect(() => {
    // Find the latest graph state from the current messages
    const latestGraphState = findLatestGraphState(messages);

    // Update the context state if the found state differs from the current one
    setConversationGraphState((prevGraphState) => {
      if (JSON.stringify(prevGraphState) !== JSON.stringify(latestGraphState)) {
        // console.log("Graph State Handler updating context:", latestGraphState); // Optional debug log
        return latestGraphState;
      }
      return prevGraphState; // No change needed
    });
  }, [messages, setConversationGraphState]); // Dependency array ensures this runs when messages change

  // This component does not render anything itself
  return null;
};
