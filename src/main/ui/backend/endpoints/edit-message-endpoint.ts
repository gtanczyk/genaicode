import { registerEndpoint } from '../api-handlers.js';

registerEndpoint((router, service) => {
  router.post('/edit-message', async (req, res) => {
    try {
      const { messageId, newContent, newData } = req.body as {
        messageId: string;
        newContent: string;
        newData?: Record<string, unknown>;
      };

      if (!messageId || typeof messageId !== 'string') {
        return res.status(400).json({ error: 'Invalid message ID' });
      }

      if (newContent === undefined && newData === undefined) {
        return res.status(400).json({ error: 'Invalid message content or data' });
      }

      // Allow empty content if newData is present (e.g. updating planning data)
      if (newContent !== undefined && (typeof newContent !== 'string' || newContent.trim().length === 0)) {
        if (!newData) {
          return res.status(400).json({ error: 'Message content cannot be empty' });
        }
      }

      const success = await service.editMessage(messageId, newContent, newData);

      if (success) {
        res.json({ message: 'Message edited successfully' });
      } else {
        res.status(404).json({ error: 'Message not found' });
      }
    } catch (error) {
      console.error('Error editing message:', error);
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'An error occurred while editing the message' });
      }
    }
  });
});
