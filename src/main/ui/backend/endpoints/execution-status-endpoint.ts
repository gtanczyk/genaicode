import { registerEndpoint } from '../api-handlers.js';

registerEndpoint((router, service) => {
  // Get execution status
  router.get('/execution-status', async (_, res) => {
    try {
      const status = await service.getExecutionStatus();
      res.json({ status });
    } catch (error) {
      console.error('Error getting execution status:', error);
      res.status(500).json({ error: 'An error occurred while getting execution status' });
    }
  });

  // Pause execution
  router.post('/pause-execution', async (_, res) => {
    try {
      await service.pauseExecution();
      res.json({ message: 'Execution paused successfully' });
    } catch (error) {
      console.error('Error pausing execution:', error);
      res.status(500).json({ error: 'An error occurred while pausing execution' });
    }
  });

  // Resume execution
  router.post('/resume-execution', async (_, res) => {
    try {
      await service.resumeExecution();
      res.json({ message: 'Execution resumed successfully' });
    } catch (error) {
      console.error('Error resuming execution:', error);
      res.status(500).json({ error: 'An error occurred while resuming execution' });
    }
  });
});
