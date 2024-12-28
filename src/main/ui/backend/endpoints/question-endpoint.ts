import { CodegenOptions } from '../../../codegen-types';
import { registerEndpoint } from '../api';
import { validateCodegenOptions } from '../api-utils';

registerEndpoint((router, service) => {
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
});
