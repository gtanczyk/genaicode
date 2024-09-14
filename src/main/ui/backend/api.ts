import express from 'express';
import { mockBackend } from './mock-backend.js';

const router = express.Router();

// Execute codegen
router.post('/execute-codegen', async (req, res) => {
  try {
    const { prompt } = req.body;

    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Invalid prompt' });
    }

    const result = await mockBackend.executeCodegen(prompt);
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

// New API endpoints for codegen output, ask-question conversation, and function calls

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

export default router;
