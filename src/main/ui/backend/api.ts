import express from 'express';
import { mockBackend } from './mock-backend.js';
import { CodegenOptions } from '../../codegen-types.js';
import { rcConfig as globalRcConfig } from '../../config.js';

const router = express.Router();

// Validation function for CodegenOptions
const validateCodegenOptions = (options: CodegenOptions): string[] => {
  const errors: string[] = [];

  if (
    typeof options.aiService !== 'string' ||
    !['vertex-ai', 'ai-studio', 'vertex-ai-claude', 'chat-gpt', 'anthropic'].includes(options.aiService)
  ) {
    errors.push('Invalid aiService');
  }

  if (
    options.temperature !== undefined &&
    (typeof options.temperature !== 'number' || options.temperature < 0 || options.temperature > 2)
  ) {
    errors.push('Temperature must be a number between 0 and 2');
  }

  if (options.imagen !== undefined && !['vertex-ai', 'dall-e'].includes(options.imagen)) {
    errors.push('Invalid imagen value');
  }

  // Add more validations as needed for other fields

  return errors;
};

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

    const result = await mockBackend.executeCodegen(prompt, options);
    res.json({ result });
  } catch (error) {
    console.error('Error executing codegen:', error);
    res.status(500).json({ error: 'An error occurred while executing codegen' });
  }
});

// Get execution status
router.get('/execution-status', async (req, res) => {
  try {
    const status = await mockBackend.getExecutionStatus();
    res.json({ status });
  } catch (error) {
    console.error('Error getting execution status:', error);
    res.status(500).json({ error: 'An error occurred while getting execution status' });
  }
});

// Pause execution
router.post('/pause-execution', async (req, res) => {
  try {
    await mockBackend.pauseExecution();
    res.json({ message: 'Execution paused successfully' });
  } catch (error) {
    console.error('Error pausing execution:', error);
    res.status(500).json({ error: 'An error occurred while pausing execution' });
  }
});

// Resume execution
router.post('/resume-execution', async (req, res) => {
  try {
    await mockBackend.resumeExecution();
    res.json({ message: 'Execution resumed successfully' });
  } catch (error) {
    console.error('Error resuming execution:', error);
    res.status(500).json({ error: 'An error occurred while resuming execution' });
  }
});

// Interrupt execution
router.post('/interrupt-execution', async (req, res) => {
  try {
    await mockBackend.interruptExecution();
    res.json({ message: 'Execution interrupted successfully' });
  } catch (error) {
    console.error('Error interrupting execution:', error);
    res.status(500).json({ error: 'An error occurred while interrupting execution' });
  }
});

// Get prompt history
router.get('/prompt-history', async (req, res) => {
  try {
    const history = await mockBackend.getPromptHistory();
    res.json({ history });
  } catch (error) {
    console.error('Error getting prompt history:', error);
    res.status(500).json({ error: 'An error occurred while getting prompt history' });
  }
});

// Get current question
router.get('/current-question', async (req, res) => {
  try {
    const question = await mockBackend.getCurrentQuestion();
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

    await mockBackend.answerQuestion(questionId, answer);
    res.json({ message: 'Question answered successfully' });
  } catch (error) {
    console.error('Error answering question:', error);
    res.status(500).json({ error: 'An error occurred while answering question' });
  }
});

// Get codegen output
router.get('/codegen-output', async (req, res) => {
  try {
    const output = await mockBackend.getCodegenOutput();
    res.json({ output });
  } catch (error) {
    console.error('Error getting codegen output:', error);
    res.status(500).json({ error: 'An error occurred while getting codegen output' });
  }
});

// Get ask-question conversation
router.get('/ask-question-conversation', async (req, res) => {
  try {
    const conversation = await mockBackend.getAskQuestionConversation();
    res.json({ conversation });
  } catch (error) {
    console.error('Error getting ask-question conversation:', error);
    res.status(500).json({ error: 'An error occurred while getting ask-question conversation' });
  }
});

// Get function calls
router.get('/function-calls', async (req, res) => {
  try {
    const functionCalls = await mockBackend.getFunctionCalls();
    res.json({ functionCalls });
  } catch (error) {
    console.error('Error getting function calls:', error);
    res.status(500).json({ error: 'An error occurred while getting function calls' });
  }
});

// Get total cost of prompts in the current session
router.get('/total-cost', async (req, res) => {
  try {
    const totalCost = await mockBackend.getTotalCost();
    res.json({ totalCost });
  } catch (error) {
    console.error('Error getting total cost:', error);
    res.status(500).json({ error: 'An error occurred while getting total cost' });
  }
});

// New endpoint: Get default CodegenOptions
router.get('/default-codegen-options', async (req, res) => {
  try {
    const defaultOptions = await mockBackend.getDefaultCodegenOptions();
    res.json({ options: defaultOptions });
  } catch (error) {
    console.error('Error getting default codegen options:', error);
    res.status(500).json({ error: 'An error occurred while getting default codegen options' });
  }
});

// New endpoint: Update CodegenOptions
router.post('/update-codegen-options', async (req, res) => {
  try {
    const { options } = req.body;

    const validationErrors = validateCodegenOptions(options);
    if (validationErrors.length > 0) {
      return res.status(400).json({ errors: validationErrors });
    }

    await mockBackend.updateCodegenOptions(options);
    res.json({ message: 'Codegen options updated successfully' });
  } catch (error) {
    console.error('Error updating codegen options:', error);
    res.status(500).json({ error: 'An error occurred while updating codegen options' });
  }
});

// New endpoint: Get rcConfig settings
router.get('/rcconfig', async (req, res) => {
  try {
    const rcConfigSettings = globalRcConfig;
    res.json({ rcConfig: rcConfigSettings });
  } catch (error) {
    console.error('Error getting rcConfig settings:', error);
    res.status(500).json({ error: 'An error occurred while getting rcConfig settings' });
  }
});

export default router;
