import express from 'express';
import { runCodegenIteration } from '../../codegen.js';

const router = express.Router();

router.post('/execute-prompt', async (req, res) => {
  try {
    const { prompt } = req.body;

    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Invalid prompt' });
    }

    try {
      await runCodegenIteration({
        aiService: 'vertex-ai',
        dryRun: true,
      });
      res.json({ result: { success: true } });
    } catch (error) {
      res.json({ result: { success: false, error: error } });
      console.error('Error executing prompt:', error);
    }
  } catch (error) {
    console.error('Error executing prompt:', error);
    res.status(500).json({ error: 'An error occurred while executing the prompt' });
  }
});

export default router;
