import express from 'express';
import multer from 'multer';
import { rcConfig as globalRcConfig } from '../../config.js';
import { validateCodegenOptions } from './api-utils.js';
import { Service } from './service.js';
import { AiServiceType, CodegenOptions } from '../../codegen-types.js';
import { getSupportedAiServices } from '../../codegen-utils.js';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_FILE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const MAX_IMAGES = 5;

const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  fileFilter: (_, file, cb) => {
    if (ALLOWED_FILE_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.'));
    }
  },
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: MAX_IMAGES,
  },
});

export function createRouter(service: Service) {
  const router = express.Router();

  // Apply token validation middleware to all routes
  router.use((req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    if (!service.validateToken(token)) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    next();
  });

  // Execute codegen (handles both regular and multimodal)
  router.post('/execute-codegen', upload.array('images', MAX_IMAGES), async (req, res) => {
    try {
      const prompt = req.body.prompt;
      const options = JSON.parse(req.body.options);
      const files = req.files as Express.Multer.File[];

      if (!prompt || typeof prompt !== 'string') {
        return res.status(400).json({ error: 'Invalid prompt' });
      }

      const validationErrors = validateCodegenOptions(options);
      if (validationErrors.length > 0) {
        return res.status(400).json({ errors: validationErrors });
      }

      const images = files?.map((file) => ({
        buffer: file.buffer,
        mimetype: file.mimetype as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
        originalname: file.originalname,
      }));

      const result = await service.executeCodegen(prompt, options as CodegenOptions, images);
      res.json({ result });
    } catch (error) {
      console.error('Error executing codegen:', error);
      if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'File size exceeds the 5MB limit' });
        }
        if (error.code === 'LIMIT_FILE_COUNT') {
          return res.status(400).json({ error: `Maximum of ${MAX_IMAGES} images allowed` });
        }
      }
      res.status(500).json({ error: 'An error occurred while executing codegen' });
    }
  });

  // New endpoint for direct content generation
  router.post('/generate-content', async (req, res) => {
    try {
      const { prompt, temperature, cheap, options } = req.body as {
        prompt: string;
        temperature: number;
        cheap: boolean;
        options: CodegenOptions;
      };

      // Validate required parameters
      if (!prompt || typeof prompt !== 'string') {
        return res.status(400).json({ error: 'Invalid prompt: must be a string' });
      }

      if (typeof temperature !== 'number' || temperature < 0 || temperature > 2) {
        return res.status(400).json({ error: 'Invalid temperature: must be a number between 0 and 2' });
      }

      if (typeof cheap !== 'boolean') {
        return res.status(400).json({ error: 'Invalid cheap parameter: must be a boolean' });
      }

      // Validate CodegenOptions
      const validationErrors = validateCodegenOptions(options);
      if (validationErrors.length > 0) {
        return res.status(400).json({ errors: validationErrors });
      }

      const result = await service.generateContent(prompt, temperature, cheap, options);
      res.json({ result });
    } catch (error) {
      console.error('Error generating content:', error);
      if (error instanceof Error) {
        res.status(500).json({ error: `An error occurred while generating content: ${error.message}` });
      } else {
        res.status(500).json({ error: 'An unknown error occurred while generating content' });
      }
    }
  });

  router.get('/content', async (_, res) => {
    try {
      const content = service.getContent();
      res.json({ content });
    } catch (error) {
      console.error('Error getting content:', error);
      res.status(500).json({ error: 'An error occurred while getting content' });
    }
  });

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

  // Interrupt execution
  router.post('/interrupt-execution', async (_, res) => {
    try {
      await service.interruptExecution();
      res.json({ message: 'Execution interrupted successfully' });
    } catch (error) {
      console.error('Error interrupting execution:', error);
      res.status(500).json({ error: 'An error occurred while interrupting execution' });
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

  // Get current question
  router.get('/current-question', async (_, res) => {
    try {
      const question = await service.getCurrentQuestion();
      res.json({ question });
    } catch (error) {
      console.error('Error getting current question:', error);
      res.status(500).json({ error: 'An error occurred while getting current question' });
    }
  });

  // Answer question
  router.post('/answer-question', async (req, res) => {
    try {
      const { questionId, answer, confirmed, options } = req.body;

      if (!questionId || typeof answer !== 'string' || typeof questionId !== 'string') {
        return res.status(400).json({ error: 'Invalid question ID or answer' });
      }

      if (options) {
        const validationErrors = validateCodegenOptions(options);
        if (validationErrors.length > 0) {
          return res.status(400).json({ errors: validationErrors });
        }
      }

      await service.answerQuestion(questionId, answer, confirmed, options as CodegenOptions);
      res.json({ message: 'Question answered successfully' });
    } catch (error) {
      console.error('Error answering question:', error);
      res.status(500).json({ error: 'An error occurred while answering question' });
    }
  });

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

  // New endpoint to delete an iteration
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

  // New endpoint to fetch available AI services
  router.get('/available-ai-services', async (_, res) => {
    try {
      const availableServices = getSupportedAiServices();
      res.json({ services: availableServices });
    } catch (error) {
      console.error('Error fetching available AI services:', error);
      res.status(500).json({ error: 'An error occurred while fetching available AI services' });
    }
  });

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

  return router;
}
