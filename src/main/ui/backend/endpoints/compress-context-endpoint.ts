import { registerEndpoint } from '../api-handlers.js';

registerEndpoint((router, service) => {
  router.post('/compress-context', async (_req, res) => {
    try {
      const result = await service.compressContext();
      return res.json(result);
    } catch (error) {
      console.error('Error compressing context:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return res.status(500).json({
        error: 'Failed to compress context',
        message: errorMessage,
      });
    }
  });
});
