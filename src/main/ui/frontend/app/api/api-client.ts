import axios from 'axios';
import { CodegenOptions } from '../../../../codegen-types.js';
import { RcConfig } from '../../../../config-lib.js';

const API_BASE_URL = '/api'; // Assuming the API is served from the same domain

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export interface PromptHistoryItem {
  prompt: string;
  cost: number;
}

export const executeCodegen = async (prompt: string, options: CodegenOptions): Promise<void> => {
  await api.post('/execute-codegen', { prompt, options });
};

export const getExecutionStatus = async (): Promise<string> => {
  const response = await api.get('/execution-status');
  return response.data.status;
};

export const pauseExecution = async (): Promise<void> => {
  await api.post('/pause-execution');
};

export const resumeExecution = async (): Promise<void> => {
  await api.post('/resume-execution');
};

export const interruptExecution = async (): Promise<void> => {
  await api.post('/interrupt-execution');
};

export const getPromptHistory = async (): Promise<PromptHistoryItem[]> => {
  const response = await api.get('/prompt-history');
  return response.data.history;
};

export const getCurrentQuestion = async (): Promise<{ id: string; text: string } | null> => {
  const response = await api.get('/current-question');
  return response.data.question;
};

export const answerQuestion = async (questionId: string, answer: string): Promise<void> => {
  await api.post('/answer-question', { questionId, answer });
};

export const getCodegenOutput = async (): Promise<string> => {
  const response = await api.get('/codegen-output');
  return response.data.output;
};

export const getAskQuestionConversation = async (): Promise<Array<{ question: string; answer: string }>> => {
  const response = await api.get('/ask-question-conversation');
  return response.data.conversation;
};

export const getFunctionCalls = async (): Promise<Array<{ name: string; args: Record<string, unknown> }>> => {
  const response = await api.get('/function-calls');
  return response.data.functionCalls;
};

export const getTotalCost = async (): Promise<number> => {
  const response = await api.get('/total-cost');
  return response.data.totalCost;
};

// New method to get default CodegenOptions from the backend
export const getDefaultCodegenOptions = async (): Promise<CodegenOptions> => {
  const response = await api.get('/default-codegen-options');
  return response.data.options;
};

// New method to update CodegenOptions on the backend
export const updateCodegenOptions = async (options: CodegenOptions): Promise<void> => {
  await api.post('/update-codegen-options', { options });
};

// New method to fetch rcConfig settings from the backend
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
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      console.error('Error data:', error.response.data);
      console.error('Error status:', error.response.status);
      console.error('Error headers:', error.response.headers);
    } else if (error.request) {
      // The request was made but no response was received
      console.error('No response received:', error.request);
    } else {
      // Something happened in setting up the request that triggered an Error
      console.error('Error message:', error.message);
    }
    return Promise.reject(error);
  },
);

export default api;
