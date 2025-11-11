import crypto from 'crypto';
import { rcConfig } from '../../config.js';
import { CodegenOptions } from '../../codegen-types.js';
import { AiServiceType } from '../../../ai-service/service-configurations-types.js';
import { RcConfig } from '../../config-types.js';
import { ServiceConfigUpdate, SanitizedServiceConfigurations } from '../common/api-types.js';
import { runCodegenWorker } from '../../interactive/codegen-worker.js';
import { abortController } from '../../common/abort-controller.js';
import { ContentProps } from '../../common/content-bus-types.js';
import { getUsageMetrics, UsageMetrics } from '../../common/cost-collector.js';
import { editMessage, putSystemMessage } from '../../common/content-bus.js';
import { CodegenResult, ConfirmationProps, Question } from '../common/api-types.js';
import { getGenerateContentFunctions } from '../../codegen.js';
import { FunctionCall, PromptImageMediaType, PromptItemImage } from '../../../ai-service/common-types.js';
import { ModelType } from '../../../ai-service/common-types.js';
import { getSanitizedServiceConfigurations, updateServiceConfig } from '../../../ai-service/service-configurations.js';
import { AppContextProvider } from '../../common/app-context-bus.js';
import {
  ActionType,
  StructuredQuestionForm,
  StructuredQuestionResponse,
} from '../../../prompt/steps/step-ask-question/step-ask-question-types.js';

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

  // Context storage for managing application context
  private contextStorage: Map<string, unknown> = new Map();

  constructor(codegenOptions: CodegenOptions) {
    this.codegenOptions = codegenOptions;
    this.securityToken = this.generateToken();
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
}
