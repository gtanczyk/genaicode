import { registerEndpoint } from '../api-handlers.js';

registerEndpoint((router, service) => {
  // Delete an iteration
  router.delete('/delete-iteration/:iterationId', async (req, res) => {
    try {
      const { iterationId } = req.params;
      await service.deleteIteration(iterationId);
      res.json({ message: 'Iteration deleted successfully' });
    } catch (error) {
      console.error('Error deleting iteration:', error);
      res.status(500).json({ error: 'An error occurred while deleting the iteration' });
    }
  });
});
