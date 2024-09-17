import express from 'express';
import { rcConfig as globalRcConfig } from '../../config.js';
import { validateCodegenOptions } from './api-utils.js';
import { Service } from './service.js';
import { CodegenOptions } from '../../codegen-types.js';

export function createRouter(service: Service) {
  const router = express.Router();

  // Execute codegen
  router.post('/execute-codegen', async (req, res) => {
    try {
      const { prompt, options } = req.body;

      if (!prompt || typeof prompt !== 'string') {
        return res.status(400).json({ error: 'Invalid prompt' });
      }

      const validationErrors = validateCodegenOptions(options);
      if (validationErrors.length > 0) {
        return res.status(400).json({ errors: validationErrors });
      }

      const result = await service.executeCodegen(prompt, options as CodegenOptions);
      res.json({ result });
    } catch (error) {
      console.error('Error executing codegen:', error);
      res.status(500).json({ error: 'An error occurred while executing codegen' });
    }
  });

  router.get('/content', async (req, res) => {
    try {
      const content = service.getContent();
      res.json({ content });
    } catch (error) {
      console.error('Error getting content:', error);
      res.status(500).json({ error: 'An error occurred while getting content' });
    }
  });

  // Get execution status
  router.get('/execution-status', async (req, res) => {
    try {
      const status = await service.getExecutionStatus();
      res.json({ status });
    } catch (error) {
      console.error('Error getting execution status:', error);
      res.status(500).json({ error: 'An error occurred while getting execution status' });
    }
  });

  // Interrupt execution
  router.post('/interrupt-execution', async (req, res) => {
    try {
      await service.interruptExecution();
      res.json({ message: 'Execution interrupted successfully' });
    } catch (error) {
      console.error('Error interrupting execution:', error);
      res.status(500).json({ error: 'An error occurred while interrupting execution' });
    }
  });

  // Get current question
  router.get('/current-question', async (req, res) => {
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
      const { questionId, answer } = req.body;

      if (!questionId || !answer || typeof questionId !== 'string' || typeof answer !== 'string') {
        return res.status(400).json({ error: 'Invalid question ID or answer' });
      }

      await service.answerQuestion(questionId, answer);
      res.json({ message: 'Question answered successfully' });
    } catch (error) {
      console.error('Error answering question:', error);
      res.status(500).json({ error: 'An error occurred while answering question' });
    }
  });

  // Get total cost of prompts in the current session
  router.get('/total-cost', async (req, res) => {
    try {
      const totalCost = await service.getTotalCost();
      res.json({ totalCost });
    } catch (error) {
      console.error('Error getting total cost:', error);
      res.status(500).json({ error: 'An error occurred while getting total cost' });
    }
  });

  // Get default CodegenOptions
  router.get('/default-codegen-options', async (req, res) => {
    try {
      const defaultOptions = service.getCodegenOptions();
      res.json({ options: defaultOptions });
    } catch (error) {
      console.error('Error getting default codegen options:', error);
      res.status(500).json({ error: 'An error occurred while getting default codegen options' });
    }
  });

  // Get rcConfig settings
  router.get('/rcconfig', async (req, res) => {
    try {
      const rcConfigSettings = globalRcConfig;
      res.json({ rcConfig: rcConfigSettings });
    } catch (error) {
      console.error('Error getting rcConfig settings:', error);
      res.status(500).json({ error: 'An error occurred while getting rcConfig settings' });
    }
  });

  return router;
}
