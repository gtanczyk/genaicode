import { registerEndpoint } from '../api.js';

registerEndpoint((router, service) => {
  router.post('/edit-message', async (req, res) => {
    try {
      const { messageId, newContent } = req.body as {
        messageId: string;
        newContent: string;
      };

      if (!messageId || typeof messageId !== 'string') {
        return res.status(400).json({ error: 'Invalid message ID' });
      }

      if (!newContent || typeof newContent !== 'string') {
        return res.status(400).json({ error: 'Invalid message content' });
      }

      if (newContent.trim().length === 0) {
        return res.status(400).json({ error: 'Message content cannot be empty' });
      }

      const success = await service.editMessage(messageId, newContent);

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
