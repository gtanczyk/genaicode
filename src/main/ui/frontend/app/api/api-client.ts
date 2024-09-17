import axios from 'axios';
import { CodegenOptions } from '../../../../codegen-types.js';
import { RcConfig } from '../../../../config-lib.js';
import { ContentProps } from '../../../../common/content-bus-types.js';

const API_BASE_URL = '/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const getContent = async (): Promise<ContentProps[]> => {
  const response = await api.get('/content');
  return response.data.content;
};

export const executeCodegen = async (prompt: string, options: CodegenOptions): Promise<void> => {
  await api.post('/execute-codegen', { prompt, options });
};

export const getExecutionStatus = async (): Promise<'idle' | 'executing'> => {
  const response = await api.get('/execution-status');
  return response.data.status;
};

export const interruptExecution = async (): Promise<void> => {
  await api.post('/interrupt-execution');
};

export const getCurrentQuestion = async (): Promise<{ id: string; text: string; isConfirmation: boolean } | null> => {
  const response = await api.get('/current-question');
  return response.data.question;
};

export const answerQuestion = async (questionId: string, answer: string): Promise<void> => {
  await api.post('/answer-question', { questionId, answer });
};

export const getTotalCost = async (): Promise<number> => {
  const response = await api.get('/total-cost');
  return response.data.totalCost;
};

export const getDefaultCodegenOptions = async (): Promise<CodegenOptions> => {
  const response = await api.get('/default-codegen-options');
  return response.data.options;
};

export const getRcConfig = async (): Promise<RcConfig> => {
  const response = await api.get('/rcconfig');
  return response.data.rcConfig;
};

// Error handling middleware
api.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error('API request failed:', error);
    if (error.response) {
      console.error('Error data:', error.response.data);
      console.error('Error status:', error.response.status);
      console.error('Error headers:', error.response.headers);
    } else if (error.request) {
      console.error('No response received:', error.request);
    } else {
      console.error('Error message:', error.message);
    }
    return Promise.reject(error);
  },
);
