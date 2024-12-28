import { registerEndpoint } from '../api';

registerEndpoint((router, service) => {
  router.get('/content', async (_, res) => {
    try {
      const content = service.getContent();
      res.json({ content });
    } catch (error) {
      console.error('Error getting content:', error);
      res.status(500).json({ error: 'An error occurred while getting content' });
    }
  });
});
