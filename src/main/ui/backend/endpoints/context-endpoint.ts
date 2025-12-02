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

  // Get list of files in context
  router.get('/context-files', async (_req, res) => {
    try {
      const files = await service.getContextFiles();
      return res.json({ files });
    } catch (error) {
      console.error('Error getting context files:', error);
      return res.status(500).json({ error: 'Failed to get context files' });
    }
  });

  // Remove files from context
  router.post('/context-files/remove', async (req, res) => {
    try {
      const { filePaths } = req.body;
      if (!Array.isArray(filePaths)) {
        return res.status(400).json({ error: 'filePaths must be an array' });
      }
      const removed = await service.removeFilesFromContext(filePaths);
      return res.json({ success: true, removed });
    } catch (error) {
      console.error('Error removing context files:', error);
      return res.status(500).json({ error: 'Failed to remove context files' });
    }
  });

  // Get all project files
  router.get('/all-project-files', async (_req, res) => {
    try {
      const files = await service.getAllProjectFiles();
      return res.json({ files });
    } catch (error) {
      console.error('Error getting all project files:', error);
      return res.status(500).json({ error: 'Failed to get all project files' });
    }
  });

  // Add files to context
  router.post('/context-files/add', async (req, res) => {
    try {
      const { filePaths } = req.body;
      if (!Array.isArray(filePaths)) {
        return res.status(400).json({ error: 'filePaths must be an array' });
      }
      const added = await service.addFilesToContext(filePaths);
      return res.json({ success: true, added });
    } catch (error) {
      console.error('Error adding context files:', error);
      return res.status(500).json({ error: 'Failed to add context files' });
    }
  });
});
