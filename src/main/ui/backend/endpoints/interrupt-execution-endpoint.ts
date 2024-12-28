import { registerEndpoint } from '../api';

registerEndpoint((router, service) => {
  router.post('/interrupt-execution', async (_, res) => {
    try {
      await service.interruptExecution();
      res.json({ message: 'Execution interrupted successfully' });
    } catch (error) {
      console.error('Error interrupting execution:', error);
      res.status(500).json({ error: 'An error occurred while interrupting execution' });
    }
  });
});
