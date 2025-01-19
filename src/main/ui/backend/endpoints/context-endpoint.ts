import { registerEndpoint } from '../api-handlers.js';

/**
 * Context value storage type
 */
interface ContextValue<T = unknown> {
  value: T;
}

/**
 * Register context-related endpoints
 */
registerEndpoint((router, service) => {
  // Get context value
  router.get('/app-context/:key', async (req, res) => {
    try {
      const key = req.params.key;
      if (!key) {
        return res.status(400).json({ error: 'Context key is required' });
      }

      const value = await service.getContextValue(key);
      return res.json({ value });
    } catch (error) {
      console.error('Error getting context:', error);
      return res.status(500).json({ error: 'Failed to get context value' });
    }
  });

  // Set context value
  router.post('/app-context/:key', async (req, res) => {
    try {
      const key = req.params.key;
      if (!key) {
        return res.status(400).json({ error: 'Context key is required' });
      }

      const contextValue: ContextValue = req.body;
      if (!contextValue || typeof contextValue.value === 'undefined') {
        return res.status(400).json({ error: 'Context value is required' });
      }

      await service.setContextValue(key, contextValue.value);
      return res.json({ success: true });
    } catch (error) {
      console.error('Error setting context:', error);
      return res.status(500).json({ error: 'Failed to set context value' });
    }
  });

  // Delete specific context
  router.delete('/app-context/:key', async (req, res) => {
    try {
      const key = req.params.key;
      if (!key) {
        return res.status(400).json({ error: 'Context key is required' });
      }

      await service.clearContextValue(key);
      return res.json({ success: true });
    } catch (error) {
      console.error('Error deleting context:', error);
      return res.status(500).json({ error: 'Failed to delete context value' });
    }
  });

  // Clear all context
  router.delete('/app-context', async (_req, res) => {
    try {
      await service.clearAllContext();
      return res.json({ success: true });
    } catch (error) {
      console.error('Error clearing context:', error);
      return res.status(500).json({ error: 'Failed to clear context' });
    }
  });
});
