import axios from 'axios';
import { AiServiceType, CodegenOptions } from '../../../../codegen-types.js';
import { RcConfig } from '../../../../config-types.js';
import { ContentProps } from '../../../../common/content-bus-types.js';
import { Question, Usage, SanitizedServiceConfigurations, ServiceConfigUpdate } from '../../../common/api-types.js';
import { FunctionCall } from '../../../../../ai-service/common-types.js';

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

/**
 * Edit a message in the conversation
 * @param messageId - The ID of the message to edit
 * @param newContent - The new content for the message
 * @throws Error if the message editing fails
 */
export const editMessage = async (messageId: string, newContent: string): Promise<void> => {
  try {
    // Validate input
    if (!messageId || !newContent.trim()) {
      throw new Error('Invalid message ID or content');
    }

    const response = await api.post('/edit-message', {
      messageId,
      newContent,
    });

    if (response.status !== 200) {
      throw new Error('Failed to edit message');
    }
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.response) {
        // The request was made and the server responded with a status code
        // that falls out of the range of 2xx
        throw new Error(error.response.data.error || 'Failed to edit message');
      } else if (error.request) {
        // The request was made but no response was received
        throw new Error('No response received from server');
      } else {
        // Something happened in setting up the request that triggered an Error
        throw new Error(`Error setting up request: ${error.message}`);
      }
    } else if (error instanceof Error) {
      throw error;
    } else {
      throw new Error('An unexpected error occurred while editing the message');
    }
  }
};

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
  modelType: 'default' | 'cheap' | 'reasoning',
  options: CodegenOptions,
): Promise<FunctionCall[]> => {
  try {
    // Check required parameters
    if (!prompt || typeof prompt !== 'string') {
      throw new Error('Prompt must be a string');
    }
    if (typeof temperature !== 'number' || temperature < 0 || temperature > 2) {
      throw new Error('Temperature must be a number between 0 and 2');
    }
    if (!['default', 'cheap', 'reasoning'].includes(modelType)) {
      throw new Error('Model type must be one of: default, cheap, reasoning');
    }

    const response = await api.post('/generate-content', {
      prompt,
      temperature,
      modelType,
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
  options?: CodegenOptions, // Made options optional to match service
  images?: File[], // Add images parameter
): Promise<void> => {
  const formData = new FormData();
  formData.append('questionId', questionId);
  formData.append('answer', answer);
  // FormData expects string values, convert boolean/undefined
  if (confirmed !== undefined) {
    formData.append('confirmed', String(confirmed));
  }
  if (options) {
    formData.append('options', JSON.stringify(options));
  }
  if (images && images.length > 0) {
    images.forEach((image) => {
      // Use the same field name ('images') as expected by multer on the backend
      formData.append('images', image);
    });
  }

  await api.post('/answer-question', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
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

/**
 * Get current service configurations
 * API keys will be masked in the response
 */
export const getServiceConfigurations = async (): Promise<SanitizedServiceConfigurations> => {
  try {
    const response = await api.get('/service-configurations');
    return response.data.configurations;
  } catch (error) {
    throw new Error('Failed to fetch service configurations');
  }
};

/**
 * Update configuration for a specific service
 */
export const updateServiceConfiguration = async (update: ServiceConfigUpdate): Promise<void> => {
  await api.post('/service-configuration', update);
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
