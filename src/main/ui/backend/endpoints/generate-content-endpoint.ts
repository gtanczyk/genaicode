import { CodegenOptions } from '../../../codegen-types.js';
import { registerEndpoint } from '../api.js';

registerEndpoint((router, service) => {
  router.post('/generate-content', async (req, res) => {
    try {
      const { prompt, temperature, cheap, options } = req.body as {
        prompt: string;
        temperature: number;
        cheap: boolean;
        options: CodegenOptions;
      };

      if (!prompt || typeof prompt !== 'string') {
        return res.status(400).json({ error: 'Invalid prompt: must be a string' });
      }

      if (typeof temperature !== 'number' || temperature < 0 || temperature > 2) {
        return res.status(400).json({ error: 'Invalid temperature: must be a number between 0 and 2' });
      }

      if (typeof cheap !== 'boolean') {
        return res.status(400).json({ error: 'Invalid cheap parameter: must be a boolean' });
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
});
