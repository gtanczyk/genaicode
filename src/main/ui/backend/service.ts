import crypto from 'crypto';
import { rcConfig } from '../../config.js';
import { CodegenOptions } from '../../codegen-types.js';
import { AiServiceType } from '../../../ai-service/service-configurations-types.js';
import { RcConfig } from '../../config-types.js';
import { ServiceConfigUpdate, SanitizedServiceConfigurations, ContextFile } from '../common/api-types.js';
import { runCodegenWorker } from '../../interactive/codegen-worker.js';
import { abortController } from '../../common/abort-controller.js';
import { ContentProps } from '../../common/content-bus-types.js';
import { getUsageMetrics, UsageMetrics } from '../../common/cost-collector.js';
import { editMessage, putSystemMessage } from '../../common/content-bus.js';
import { CodegenResult, ConfirmationProps, Question } from '../common/api-types.js';
import { getGenerateContentFunctions } from '../../codegen.js';
import { FunctionCall, PromptImageMediaType, PromptItem, PromptItemImage } from '../../../ai-service/common-types.js';
import { ModelType } from '../../../ai-service/common-types.js';
import { getSanitizedServiceConfigurations, updateServiceConfig } from '../../../ai-service/service-configurations.js';
import { AppContextProvider } from '../../common/app-context-bus.js';
import {
  ActionType,
  StructuredQuestionForm,
  StructuredQuestionResponse,
} from '../../../prompt/steps/step-ask-question/step-ask-question-types.js';
import { SourceCodeMap } from '../../../files/source-code-types.js';
import { estimateTokenCount } from '../../../prompt/token-estimator.js';
import { executeStepContextOptimization } from '../../../prompt/steps/step-context-optimization.js';
import { executeStepContextCompression } from '../../../prompt/steps/step-context-compression.js';
import { getFilesContextSizeFromPrompt } from '../../../prompt/context-utils.js';

export interface ImageData {
  buffer: Buffer;
  mimetype: PromptImageMediaType;
  originalname: string;
}

interface AskQuestionConversationItem {
  id: string;
  question: string;
  answer: string;
  confirmed: boolean | undefined;
  confirmation: ConfirmationProps;
  images?: PromptItemImage[];
  selectedActionType?: ActionType | undefined;
  structuredResponse?: StructuredQuestionResponse;
}

export class Service implements AppContextProvider {
  private executionStatus: 'idle' | 'executing' | 'paused' | 'interrupted' = 'idle';
  private currentQuestion: Question | null = null;
  private askQuestionConversation: AskQuestionConversationItem[] = [];
  private codegenOptions: CodegenOptions;
  private content: ContentProps[] = [];
  private pausePromiseResolve: (() => void) | null = null;
  private securityToken: string;
  private getContext: () => PromptItem[] = () => [];

  // Context storage for managing application context
  private contextStorage: Map<string, unknown> = new Map();

  constructor(codegenOptions: CodegenOptions, getContext: () => PromptItem[]) {
    this.codegenOptions = codegenOptions;
    this.securityToken = this.generateToken();
    this.getContext = getContext;
  }

  /**
   * Expose the current prompt context items (PromptItem[])
   */
  public getPromptContext(): PromptItem[] {
    return this.getContext();
  }

  /**
   * Edit a message in the conversation
   * @param messageId ID of the message to edit
   * @param newContent New content for the message
   * @returns true if the message was successfully edited, false otherwise
   * @throws Error if the message ID is invalid or if editing is not allowed
   */
  async editMessage(messageId: string, newContent: string): Promise<boolean> {
    // Basic input validation
    if (!messageId || !newContent.trim()) {
      throw new Error('Invalid message ID or content');
    }

    // Find the message in the content array
    const contentItem = this.content.find((item) => item.message?.id === messageId);
    if (!contentItem || !contentItem.message) {
      throw new Error('Message not found');
    }

    // Check if editing is allowed for this message type
    if (contentItem.message.type === 'system') {
      throw new Error('System messages cannot be edited');
    }

    // Check if the message is from an ongoing iteration
    const currentIterationId = this.getCurrentIterationId();
    if (contentItem.message.iterationId !== currentIterationId || this.executionStatus === 'idle') {
      throw new Error('Can only edit messages from the currently ongoing iteration');
    }

    // Try to edit the message using content bus
    const success = editMessage(contentItem, newContent);
    return success;
  }

  /**
   * Get service configurations in a safe format that excludes sensitive data.
   * This method is used by external API endpoints.
   */
  public getServiceConfigurations(): SanitizedServiceConfigurations {
    return getSanitizedServiceConfigurations();
  }

  /**
   * Update service configuration.
   * This method still accepts full configuration updates to maintain functionality,
   * but sensitive data is properly handled internally.
   */
  public updateServiceConfiguration(update: ServiceConfigUpdate): void {
    updateServiceConfig(update.serviceType, update.config);
  }

  private generateToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  public getToken(): string {
    return this.securityToken;
  }

  public validateToken(token: string): boolean {
    return token === this.securityToken;
  }

  public refreshToken(): string {
    this.securityToken = this.generateToken();
    return this.securityToken;
  }

  async executeCodegen(prompt: string, options: CodegenOptions, images?: ImageData[]): Promise<CodegenResult> {
    this.executionStatus = 'executing';
    this.currentQuestion = null;
    this.codegenOptions = { ...this.codegenOptions, ...options };

    try {
      const imageDataForPrompt = images?.map((image) => ({
        base64url: image.buffer.toString('base64'),
        mediaType: image.mimetype,
        originalName: image.originalname,
      }));

      await runCodegenWorker(
        {
          ...this.codegenOptions,
          explicitPrompt: prompt,
          images: imageDataForPrompt,
          vision: this.codegenOptions.vision || !!imageDataForPrompt?.length,
        },
        () => this.waitIfPaused(),
      );
      this.executionStatus = 'idle';
      return { success: true };
    } catch (error) {
      console.error('Error executing codegen:', error);
      this.executionStatus = 'idle';
      if (error instanceof Error) {
        if (error.name === 'AbortError' || error.message.includes('interrupted')) {
          return {
            success: false,
            message: 'Codegen execution was interrupted',
          };
        } else if (error.message.includes('Rate limit exceeded')) {
          return {
            success: false,
            message: 'Rate limit exceeded. Consider switching to a different AI service or waiting before retrying.',
          };
        }
        return { success: false, message: `An error occurred: ${error.message}` };
      }
      return { success: false, message: 'An unknown error occurred' };
    }
  }

  async generateContent(
    prompt: string,
    temperature: number,
    modelType: ModelType,
    options: CodegenOptions,
  ): Promise<FunctionCall[]> {
    try {
      // Validate the AI service is available
      const generateContentFns = getGenerateContentFunctions();
      if (!generateContentFns[options.aiService]) {
        throw new Error(`AI service ${options.aiService} is not available`);
      }
      const generateContenFn = generateContentFns[options.aiService];

      // Use the AI service fallback mechanism for better reliability
      const result = await generateContenFn(
        [
          {
            type: 'user',
            text: prompt,
          },
        ],
        {
          functionDefs:
            modelType === ModelType.REASONING
              ? []
              : [
                  {
                    name: 'printMessage',
                    description: 'Print a message',
                    parameters: {
                      type: 'object',
                      properties: { message: { type: 'string' } },
                      required: ['message'],
                    },
                  },
                ],
          requiredFunctionName: modelType === ModelType.REASONING ? 'reasoningInferenceResponse' : 'printMessage',
          temperature,
          modelType,
          expectedResponseType: {
            functionCall: true,
            text: false,
            media: false,
          },
        },
        options,
      );

      return result.filter((item) => item.type === 'functionCall').map((item) => item.functionCall);
    } catch (error) {
      console.error('Error in generateContent:', error);
      throw error;
    }
  }

  async interruptExecution(): Promise<void> {
    if (this.executionStatus === 'executing' || this.executionStatus === 'paused') {
      abortController?.abort();
      this.executionStatus = 'interrupted';
      this.currentQuestion = null;
      putSystemMessage('Execution interrupted');
    }
  }

  async pauseExecution(): Promise<void> {
    if (this.executionStatus === 'executing') {
      this.executionStatus = 'paused';
      putSystemMessage('Execution paused');
    }
  }

  async resumeExecution(): Promise<void> {
    if (this.executionStatus === 'paused') {
      this.executionStatus = 'executing';
      putSystemMessage('Execution resumed');
      if (this.pausePromiseResolve) {
        this.pausePromiseResolve();
        this.pausePromiseResolve = null;
      }
    }
  }

  /**
   * Optimize the current context
   */
  async optimizeContext(): Promise<{
    success: boolean;
    message?: string;
    stats?: { tokensBefore: number; tokensAfter: number; savings: number; percentage: number };
  }> {
    try {
      const prompt = this.getContext();
      const generateContentFns = getGenerateContentFunctions();
      const generateContentFn = generateContentFns[this.codegenOptions.aiService];

      if (!generateContentFn) {
        throw new Error(`AI service ${this.codegenOptions.aiService} is not available`);
      }

      // Estimate tokens before
      const tokensBefore = estimateTokenCount(JSON.stringify(prompt));

      // Execute optimization
      await executeStepContextOptimization(generateContentFn, prompt, this.codegenOptions);

      // Estimate tokens after
      const tokensAfter = estimateTokenCount(JSON.stringify(prompt));
      const filesContextSize = getFilesContextSizeFromPrompt(prompt);
      putSystemMessage('Context optimization applied', { filesContextSize, contextSize: tokensAfter });

      return {
        success: true,
        stats: {
          tokensBefore,
          tokensAfter,
          savings: tokensBefore - tokensAfter,
          percentage: tokensBefore > 0 ? Math.round(((tokensBefore - tokensAfter) / tokensBefore) * 100) : 0,
        },
      };
    } catch (error) {
      console.error('Error optimizing context:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error during context optimization',
      };
    }
  }

  /**
   * Compress the current context
   */
  async compressContext(): Promise<{
    success: boolean;
    message?: string;
    stats?: { tokensBefore: number; tokensAfter: number; savings: number; percentage: number };
  }> {
    try {
      const prompt = this.getContext();
      const generateContentFns = getGenerateContentFunctions();
      const generateContentFn = generateContentFns[this.codegenOptions.aiService];

      if (!generateContentFn) {
        throw new Error(`AI service ${this.codegenOptions.aiService} is not available`);
      }

      // Estimate tokens before
      const tokensBefore = estimateTokenCount(JSON.stringify(prompt));

      // Execute compression
      await executeStepContextCompression(generateContentFn, prompt, this.codegenOptions);

      // Estimate tokens after
      const tokensAfter = estimateTokenCount(JSON.stringify(prompt));
      const filesContextSize = getFilesContextSizeFromPrompt(prompt);
      putSystemMessage('Context compression applied', {
        tokensBefore,
        tokensAfter,
        filesContextSize,
        contextSize: tokensAfter,
      });

      return {
        success: true,
        stats: {
          tokensBefore,
          tokensAfter,
          savings: tokensBefore - tokensAfter,
          percentage: tokensBefore > 0 ? Math.round(((tokensBefore - tokensAfter) / tokensBefore) * 100) : 0,
        },
      };
    } catch (error) {
      console.error('Error compressing context:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error during context compression',
      };
    }
  }

  async getContextPreview(): Promise<{
    preview: {
      type: string;
      summary: string;
      tokenCount: number;
    }[];
    totalTokens: number;
  }> {
    const prompt = this.getContext();
    const preview = prompt.map((item) => {
      let summary = '';

      if (item.type === 'user') {
        const text = item.text ?? '';
        summary = text ? text.substring(0, 100) + (text.length > 100 ? '...' : '') : 'User Input';
        if (Array.isArray(item.images) && item.images.length > 0) {
          summary += ` [${item.images.length} images]`;
        }
        if (item.functionResponses?.length) {
          const name = item.functionResponses.map((fr) => fr.name).join(', ') as string | undefined;
          summary += ` Function Response${name ? `: ${name}` : ''}`;
        }
      } else if (item.type === 'assistant') {
        // assistant may contain text and/or functionCalls
        const text = item.text as string | undefined;
        if (text) {
          summary = text.substring(0, 100) + (text.length > 100 ? '...' : '');
        } else if (Array.isArray(item.functionCalls)) {
          const names = item.functionCalls.map((fc) => fc?.name).filter(Boolean);
          summary = names.length ? `Assistant: ${names.join(', ')}` : 'Assistant';
        } else {
          summary = 'Assistant';
        }
      } else if (item.type === 'systemPrompt') {
        const text = item.text as string | undefined;
        summary = text ? text.substring(0, 100) + (text.length > 100 ? '...' : '') : 'System Prompt';
      }

      return {
        type: item.type,
        summary,
        tokenCount: estimateTokenCount(JSON.stringify(item)),
      };
    });

    const totalTokens = estimateTokenCount(JSON.stringify(prompt));
    return { preview, totalTokens };
  }

  async getExecutionStatus(): Promise<string> {
    return this.executionStatus;
  }

  async getCurrentQuestion(): Promise<Question | null> {
    return this.currentQuestion;
  }

  async askQuestion(
    question: string,
    confirmation: ConfirmationProps,
  ): Promise<{
    answer: string;
    confirmed: boolean | undefined;
    options: CodegenOptions;
    images?: PromptItemImage[];
    selectedActionType?: ActionType | undefined;
  }> {
    const questionId = Date.now().toString();
    this.currentQuestion = {
      id: questionId,
      text: question,
      confirmation,
    };

    await this.waitForQuestionAnswer();

    console.log('Question answer wait finished.');
    const conversationItem = this.askQuestionConversation.find((q) => q.id === questionId);

    if (!conversationItem) {
      // Should ideally not happen if waitForQuestionAnswer resolved correctly
      throw new Error(`Conversation item not found for question ID: ${questionId}`);
    }

    const { answer, confirmed, images, selectedActionType } = conversationItem;
    return { answer, confirmed, images, options: this.codegenOptions, selectedActionType };
  }

  async askStructuredQuestion(question: string, form: StructuredQuestionForm): Promise<StructuredQuestionResponse> {
    const questionId = Date.now().toString();
    this.currentQuestion = {
      id: questionId,
      text: question,
      confirmation: {},
      structuredForm: form,
    };

    await this.waitForQuestionAnswer();

    console.log('Structured question answer wait finished.');
    const conversationItem = this.askQuestionConversation.find((q) => q.id === questionId);

    if (!conversationItem || !conversationItem.structuredResponse) {
      // Should ideally not happen if waitForQuestionAnswer resolved correctly
      throw new Error(`Conversation item or structured response not found for question ID: ${questionId}`);
    }

    return conversationItem.structuredResponse;
  }

  async answerQuestion(
    questionId: string,
    answer: string,
    confirmed: boolean | undefined,
    images?: ImageData[], // Accept raw image data from the endpoint
    options?: CodegenOptions,
    selectedActionType?: ActionType | undefined,
    structuredResponse?: StructuredQuestionResponse,
  ): Promise<void> {
    if (this.currentQuestion && this.currentQuestion.id === questionId) {
      // Update codegenOptions if provided
      if (options) {
        this.codegenOptions = { ...this.codegenOptions, ...options };
      }

      // Process images into the format needed for storage/AI service (PromptItemImage)
      const processedImages: PromptItemImage[] | undefined = images?.map((image) => ({
        base64url: image.buffer.toString('base64'),
        mediaType: image.mimetype,
      }));

      // Store the answer and processed images in the conversation history
      this.askQuestionConversation.push({
        id: this.currentQuestion.id,
        question: this.currentQuestion.text,
        answer: answer,
        confirmed,
        confirmation: this.currentQuestion.confirmation,
        images: processedImages, // Store the processed images
        selectedActionType,
        structuredResponse,
      });

      // Clear the current question now that it's answered
      this.currentQuestion = null;
    } else {
      // Handle cases where the question ID doesn't match or no question is active
      console.warn(`Attempted to answer question ${questionId}, but no matching active question found.`);
      // Consider throwing an error or returning a specific status if needed
    }
  }

  handleContent(content: ContentProps): void {
    this.content.push(content);
  }

  getContent(): ContentProps[] {
    return this.content;
  }

  async getUsageMetrics(): Promise<Record<AiServiceType | 'total', UsageMetrics>> {
    return await getUsageMetrics();
  }

  getCodegenOptions(): CodegenOptions {
    return this.codegenOptions;
  }

  async getRcConfig(): Promise<RcConfig> {
    return rcConfig;
  }

  getCurrentIterationId(): string | null {
    return this.executionStatus !== 'idle' ? (this.content.slice(-1)[0]?.message?.iterationId ?? null) : null;
  }

  async deleteIteration(iterationId: string): Promise<void> {
    const currentIterationId = this.getCurrentIterationId();
    this.content = this.content.filter(
      (content) =>
        content.message?.iterationId !== iterationId ||
        // do not delete ongoing iterations
        iterationId === currentIterationId,
    );
  }

  private waitForQuestionAnswer(): Promise<void> {
    return new Promise((resolve, reject) => {
      const checkQuestion = () => {
        if (abortController?.signal.aborted || this.executionStatus === 'interrupted') {
          // Reject if aborted before the question is answered
          this.currentQuestion = null; // Clear potentially dangling question
          reject(new Error('Codegen execution was interrupted'));
        } else if (this.currentQuestion === null) {
          // Resolve once the question is cleared (answered)
          resolve();
        } else {
          // Check again shortly
          setTimeout(checkQuestion, 100);
        }
      };
      checkQuestion();
    });
  }

  async waitIfPaused(): Promise<void> {
    if (this.executionStatus === 'paused') {
      return new Promise((resolve) => {
        this.pausePromiseResolve = resolve;
      });
    }
  }

  /**
   * Get a context value by key
   * @param key The context key
   * @returns The stored value, or undefined if not found
   */
  async getContextValue<T = unknown>(key: string): Promise<T | undefined> {
    return this.contextStorage.get(key) as T | undefined;
  }

  /**
   * Set a context value
   * @param key The context key
   * @param value The value to store
   */
  async setContextValue<T = unknown>(key: string, value: T): Promise<void> {
    if (!key) {
      throw new Error('Context key is required');
    }
    this.contextStorage.set(key, value);
  }

  /**
   * Clear a specific context value
   * @param key The context key to clear
   */
  async clearContextValue(key: string): Promise<void> {
    if (!key) {
      throw new Error('Context key is required');
    }
    this.contextStorage.delete(key);
  }

  /**
   * Clear all context values
   */
  async clearAllContext(): Promise<void> {
    this.contextStorage.clear();
  }

  /**
   * Get list of files currently in the conversation context
   * @returns Array of unique file paths
   */
  async getContextFiles(): Promise<ContextFile[]> {
    const contextFilesMap = new Map<string, number>();

    for (const item of this.getContext()) {
      for (const response of item.functionResponses ?? []) {
        if (response.name === 'getSourceCode' && response.content) {
          try {
            const sourceCode = JSON.parse(response.content);
            for (const [filePath, fileData] of Object.entries(sourceCode)) {
              if (fileData && typeof fileData === 'object' && 'content' in fileData && fileData.content !== null) {
                const content = String(fileData.content);
                const tokenCount = estimateTokenCount(content);
                contextFilesMap.set(filePath, tokenCount);
              }
            }
          } catch (error) {
            console.warn('Failed to parse getSourceCode response while fetching context files:', error);
          }
        }
      }
    }

    return Array.from(contextFilesMap.entries())
      .map(([path, tokenCount]) => ({ path, tokenCount }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  /**
   * Remove files from the conversation context by setting their content to null
   * @param filePaths Array of file paths to remove
   * @returns Number of files removed
   */
  async removeFilesFromContext(filePaths: string[]): Promise<number> {
    if (!Array.isArray(filePaths) || filePaths.length === 0) {
      return 0;
    }

    const filesToRemove = new Set(filePaths);
    const removedFiles = new Set<string>();

    for (const item of this.getContext()) {
      for (const response of item.functionResponses ?? []) {
        if (response.name === 'getSourceCode' && response.content) {
          try {
            const sourceCode = JSON.parse(response.content) as SourceCodeMap;
            let modified = false;

            for (const filePath of filesToRemove) {
              if (
                sourceCode[filePath] &&
                typeof sourceCode[filePath] === 'object' &&
                'content' in sourceCode[filePath] &&
                sourceCode[filePath].content !== null
              ) {
                sourceCode[filePath].content = null;
                removedFiles.add(filePath);
                modified = true;
              }
            }

            if (modified) {
              response.content = JSON.stringify(sourceCode);
            }
          } catch (error) {
            console.warn('Failed to parse getSourceCode response while removing context files:', error);
          }
        }
      }
    }

    if (removedFiles.size > 0) {
      const filesContextSize = getFilesContextSizeFromPrompt(this.getContext());
      putSystemMessage('Context reduction applied', { removed: Array.from(removedFiles), filesContextSize });
    }

    return removedFiles.size;
  }

  /**
   * Get all project files (not just those in context)
   * @returns Array of file paths
   */
  async getAllProjectFiles(): Promise<string[]> {
    const { getSourceFiles } = await import('../../../files/find-files.js');
    return getSourceFiles();
  }

  /**
   * Add files to the conversation context by fetching their content
   * @param filePaths Array of file paths to add
   * @returns Number of files added
   */
  async addFilesToContext(filePaths: string[]): Promise<number> {
    if (!Array.isArray(filePaths) || filePaths.length === 0) {
      return 0;
    }

    const { getSourceCode } = await import('../../../files/read-files.js');
    const { putSystemMessage } = await import('../../common/content-bus.js');

    try {
      // Fetch the content of the requested files
      const sourceCode = getSourceCode({ filterPaths: filePaths, forceAll: true }, this.codegenOptions);

      // Create a getSourceCode function response and inject it into the context
      const functionResponse = {
        name: 'getSourceCode',
        content: JSON.stringify(sourceCode),
      };

      // Find the most recent prompt item in the context to attach the response
      const contextItems = this.getContext();
      if (contextItems.length > 0) {
        const lastItem = contextItems[contextItems.length - 1];
        if (!lastItem.functionResponses) {
          lastItem.functionResponses = [];
        }
        lastItem.functionResponses.push(functionResponse);
      }

      const addedCount = filePaths.length;
      const filesContextSize = getFilesContextSizeFromPrompt(this.getContext());
      putSystemMessage('Files added to context', { added: filePaths, filesContextSize });

      return addedCount;
    } catch (error) {
      console.error('Failed to add files to context:', error);
      throw error;
    }
  }
}
