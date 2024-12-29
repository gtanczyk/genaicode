import { registerEndpoint } from '../api-handlers.js';
import { rcConfig as globalRcConfig } from '../../../config.js';
import { getSupportedAiServices } from '../../../codegen-utils.js';

registerEndpoint((router, service) => {
  // Get default CodegenOptions
  router.get('/default-codegen-options', async (_, res) => {
    try {
      const defaultOptions = service.getCodegenOptions();
      res.json({ options: defaultOptions });
    } catch (error) {
      console.error('Error getting default codegen options:', error);
      res.status(500).json({ error: 'An error occurred while getting default codegen options' });
    }
  });

  // Get rcConfig settings
  router.get('/rcconfig', async (_, res) => {
    try {
      const rcConfigSettings = globalRcConfig;
      res.json({ rcConfig: rcConfigSettings });
    } catch (error) {
      console.error('Error getting rcConfig settings:', error);
      res.status(500).json({ error: 'An error occurred while getting rcConfig settings' });
    }
  });

  // Fetch available AI services
  router.get('/available-ai-services', async (_, res) => {
    try {
      const availableServices = getSupportedAiServices();
      res.json({ services: availableServices });
    } catch (error) {
      console.error('Error fetching available AI services:', error);
      res.status(500).json({ error: 'An error occurred while fetching available AI services' });
    }
  });
});
