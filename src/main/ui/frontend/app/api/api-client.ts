import axios from 'axios';
import { AiServiceType, CodegenOptions } from '../../../../codegen-types.js';
import { RcConfig } from '../../../../config-lib.js';
import { ContentProps } from '../../../../common/content-bus-types.js';
import { Question, Usage } from '../../../common/api-types.js';
import { FunctionCall } from '../../../../../ai-service/common.js';

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

// New function to handle direct content generation
export const generateContent = async (
  prompt: string,
  temperature: number,
  cheap: boolean,
  options: CodegenOptions,
): Promise<FunctionCall[]> => {
  try {
    // Check required parameters
    if (!Array.isArray(prompt)) {
      throw new Error('Prompt must be an array of PromptItem');
    }
    if (typeof temperature !== 'number' || temperature < 0 || temperature > 2) {
      throw new Error('Temperature must be a number between 0 and 2');
    }
    if (typeof cheap !== 'boolean') {
      throw new Error('Cheap parameter must be a boolean');
    }

    const response = await api.post('/generate-content', {
      prompt,
      temperature,
      cheap,
      options,
    });

    return response.data.result;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.response) {
        // Handle specific API error responses
        const errorMessage = error.response.data.error || 'Unknown server error';
        throw new Error(`Content generation failed: ${errorMessage}`);
      } else if (error.request) {
        throw new Error('No response received from server during content generation');
      } else {
        throw new Error(`Request setup failed: ${error.message}`);
      }
    }
    // Re-throw validation errors
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('An unexpected error occurred during content generation');
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

export const getCurrentQuestion = async (): Promise<Question | null> => {
  const response = await api.get('/current-question');
  return response.data.question;
};

export const answerQuestion = async (
  questionId: string,
  answer: string,
  confirmed: boolean | undefined,
  options: CodegenOptions,
): Promise<void> => {
  await api.post('/answer-question', { questionId, answer, confirmed, options });
};

export const getUsage = async (): Promise<Usage> => {
  const response = await api.get('/usage');
  return response.data;
};

export const getDefaultCodegenOptions = async (): Promise<CodegenOptions> => {
  const response = await api.get('/default-codegen-options');
  return response.data.options;
};

export const getRcConfig = async (): Promise<RcConfig> => {
  const response = await api.get('/rcconfig');
  return response.data.rcConfig;
};

// New API method to delete an iteration
export const deleteIteration = async (iterationId: string): Promise<void> => {
  await api.delete(`/delete-iteration/${iterationId}`);
};

export const getAvailableAiServices = async (): Promise<AiServiceType[]> => {
  const response = await api.get('/available-ai-services');
  return response.data.services as AiServiceType[];
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
