import { ModelType } from '../../../../ai-service/common-types.js';
import { CodegenOptions } from '../../../codegen-types.js';
import { registerEndpoint } from '../api-handlers.js';

registerEndpoint((router, service) => {
  router.post('/generate-content', async (req, res) => {
    try {
      const { prompt, temperature, modelType, options } = req.body as {
        prompt: string;
        temperature: number;
        modelType: 'default' | 'cheap' | 'reasoning';
        options: CodegenOptions;
      };

      if (!prompt || typeof prompt !== 'string') {
        return res.status(400).json({ error: 'Invalid prompt: must be a string' });
      }

      if (typeof temperature !== 'number' || temperature < 0 || temperature > 2) {
        return res.status(400).json({ error: 'Invalid temperature: must be a number between 0 and 2' });
      }

      if (!['default', 'cheap', 'reasoning', 'lite'].includes(modelType)) {
        return res
          .status(400)
          .json({ error: 'Invalid modelType parameter: must be one of: default, cheap, reasoning' });
      }

      const result = await service.generateContent(prompt, temperature, modelType as ModelType, options);
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
});
