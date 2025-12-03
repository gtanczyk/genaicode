import { registerEndpoint } from '../api-handlers.js';
import { estimateTokenCount } from '../../../../prompt/token-estimator.js';

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

  // Trigger context optimization
  router.post('/context-optimization', async (_req, res) => {
    try {
      // Check if the service has the optimizeContext method
      if (typeof service.optimizeContext !== 'function') {
        console.error('optimizeContext method not available on service');
        return res.status(501).json({
          error: 'Context optimization is not implemented',
          message: 'The optimization feature requires an active codegen session',
        });
      }

      const result = await service.optimizeContext();
      return res.json({ success: true, result });
    } catch (error) {
      console.error('Error optimizing context:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return res.status(500).json({
        error: 'Failed to optimize context',
        message: errorMessage,
      });
    }
  });

  // Get context preview
  router.get('/context-preview', async (_req, res) => {
    try {
      if (typeof service.getContextPreview !== 'function') {
        return res.status(501).json({ error: 'Context preview not implemented' });
      }
      const result = await service.getContextPreview();
      return res.json(result);
    } catch (error) {
      console.error('Error getting context preview:', error);
      return res.status(500).json({ error: 'Failed to get context preview' });
    }
  });

  // Get full prompt context and total token count
  router.get('/prompt', async (_req, res) => {
    try {
      const promptItems = service.getPromptContext();
      const totalTokens = estimateTokenCount(JSON.stringify(promptItems));
      return res.json({ promptItems, totalTokens });
    } catch (error) {
      console.error('Error getting prompt context:', error);
      return res.status(500).json({ error: 'Failed to get prompt context' });
    }
  });
});
