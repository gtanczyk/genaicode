import { registerEndpoint } from '../api';

registerEndpoint((router, service) => {
  // Get total cost of prompts in the current session
  router.get('/usage', async (_, res) => {
    try {
      const usageMetrics = await service.getUsageMetrics();
      res.json({ usageMetrics });
    } catch (error) {
      console.error('Error getting total cost:', error);
      res.status(500).json({ error: 'An error occurred while getting total cost' });
    }
  });
});
