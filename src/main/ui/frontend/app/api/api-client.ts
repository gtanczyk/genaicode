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

// Function to extract security token from index.html
const getSecurityToken = async (): Promise<string | null> => {
  try {
    const response = await fetch('/');
    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const token = doc.body.getAttribute('data-security-token');
    return token;
  } catch (error) {
    console.error('Error fetching security token:', error);
    return null;
  }
};

// Add a request interceptor to include the security token in all requests
api.interceptors.request.use(
  (config) => {
    const securityToken = document.querySelector('body[data-security-token]')?.getAttribute('data-security-token');
    if (securityToken) {
      config.headers['Authorization'] = `Bearer ${securityToken}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  },
);

// Add a response interceptor to handle 401 Unauthorized errors
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    if (error.response && error.response.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      const newToken = await getSecurityToken();
      if (newToken) {
        // Update Authorization header with new token
        originalRequest.headers['Authorization'] = `Bearer ${newToken}`;
        document.querySelector('body[data-security-token]')?.setAttribute('data-security-token', newToken);
        return api(originalRequest);
      }
    }
    return Promise.reject(error);
  },
);

export const getContent = async (): Promise<ContentProps[]> => {
  const response = await api.get('/content');
  return response.data.content;
};

export const executeCodegen = async (prompt: string, options: CodegenOptions, images?: File[]): Promise<void> => {
  const formData = new FormData();
  formData.append('prompt', prompt);
  formData.append('options', JSON.stringify(options));

  if (images && images.length > 0) {
    images.forEach((image) => {
      formData.append('images', image);
    });
  }

  try {
    await api.post('/execute-codegen', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.response) {
        throw new Error(`Server error: ${error.response.data.message || 'Unknown error'}`);
      } else if (error.request) {
        throw new Error('No response received from server');
      } else {
        throw new Error(`Error setting up request: ${error.message}`);
      }
    } else {
      throw new Error('An unexpected error occurred');
    }
  }
};

export const getExecutionStatus = async (): Promise<'idle' | 'executing' | 'paused'> => {
  const response = await api.get('/execution-status');
  return response.data.status;
};

export const interruptExecution = async (): Promise<void> => {
  await api.post('/interrupt-execution');
};

export const pauseExecution = async (): Promise<void> => {
  await api.post('/pause-execution');
};

export const resumeExecution = async (): Promise<void> => {
  await api.post('/resume-execution');
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
