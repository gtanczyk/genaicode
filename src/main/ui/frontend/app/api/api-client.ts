import axios from 'axios';

const API_BASE_URL = '/api'; // Assuming the API is served from the same domain

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const executeCodegen = async (prompt: string): Promise<void> => {
  await api.post('/execute-codegen', { prompt });
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

export const getPromptHistory = async (): Promise<string[]> => {
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

// New API functions to fetch codegen output, ask-question conversation, and function calls

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
