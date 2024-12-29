import { registerEndpoint } from '../api-handlers.js';
import { AiServiceType } from '../../../codegen-types.js';
import { getSupportedAiServices } from '../../../codegen-utils.js';

registerEndpoint((router, service) => {
  // Get service configurations
  router.get('/service-configurations', async (_, res) => {
    try {
      const configurations = service.getServiceConfigurations();
      res.json({ configurations });
    } catch (error) {
      console.error('Error getting service configurations:', error);
      res.status(500).json({ error: 'An error occurred while getting service configurations' });
    }
  });

  // Update service configuration
  router.post('/service-configuration', async (req, res) => {
    try {
      const { serviceType, config } = req.body;

      // Validate service type
      if (!serviceType || typeof serviceType !== 'string') {
        return res.status(400).json({ error: 'Invalid service type' });
      }

      // Validate that the service type is supported
      const supportedServices = getSupportedAiServices() as string[];
      if (!supportedServices.includes(serviceType)) {
        return res.status(400).json({ error: 'Unsupported service type' });
      }

      // Validate config object
      if (!config || typeof config !== 'object') {
        return res.status(400).json({ error: 'Invalid configuration object' });
      }

      // Validate API key if provided
      if (config.apiKey !== undefined && typeof config.apiKey !== 'string') {
        return res.status(400).json({ error: 'Invalid API key format' });
      }

      // Validate model overrides if provided
      if (config.modelOverrides) {
        if (config.modelOverrides.default !== undefined && typeof config.modelOverrides.default !== 'string') {
          return res.status(400).json({ error: 'Invalid default model override' });
        }
        if (config.modelOverrides.cheap !== undefined && typeof config.modelOverrides.cheap !== 'string') {
          return res.status(400).json({ error: 'Invalid cheap model override' });
        }
      }

      service.updateServiceConfiguration({ serviceType: serviceType as AiServiceType, config });
      res.json({ message: 'Service configuration updated successfully' });
    } catch (error) {
      console.error('Error updating service configuration:', error);
      res.status(500).json({ error: 'An error occurred while updating service configuration' });
    }
  });
});
