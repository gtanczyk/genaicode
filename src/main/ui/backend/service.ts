import { rcConfig } from '../../config.js';
import { AiServiceType, CodegenOptions } from '../../codegen-types.js';
import { RcConfig } from '../../config-lib.js';
import { runCodegenWorker, abortController } from '../../interactive/codegen-worker.js';
import { ContentProps } from '../../common/content-bus-types.js';
import { getUsageMetrics, UsageMetrics } from '../../common/cost-collector.js';
import { putSystemMessage } from '../../common/content-bus.js';
import crypto from 'crypto';

interface CodegenResult {
  success: boolean;
  message?: string;
}

interface Question {
  id: string;
  text: string;
  isConfirmation: { includeAnswer: boolean } | undefined;
}

interface ImageData {
  buffer: Buffer;
  mimetype: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  originalname: string;
}

export class Service {
  private executionStatus: 'idle' | 'executing' | 'paused' | 'interrupted' = 'idle';
  private currentQuestion: Question | null = null;
  private askQuestionConversation: Array<{
    id: string;
    question: string;
    answer: string;
    confirmed: boolean | undefined;
    isConfirmation: { includeAnswer: boolean } | undefined;
  }> = [];
  private codegenOptions: CodegenOptions;
  private content: ContentProps[] = [];
  private pausePromiseResolve: (() => void) | null = null;
  private securityToken: string;

  constructor(codegenOptions: CodegenOptions) {
    this.codegenOptions = codegenOptions;
    this.securityToken = this.generateToken();
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
          considerAllFiles: true,
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
          return { success: false, message: 'Codegen execution was interrupted' };
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
    isConfirmation: { includeAnswer: boolean } | undefined,
  ): Promise<{ answer: string; confirmed: boolean | undefined }> {
    const questionId = Date.now().toString();
    this.currentQuestion = {
      id: questionId,
      text: question,
      isConfirmation,
    };

    await this.waitForQuestionAnswer();

    console.log('Question answer wait finished.');
    const { answer, confirmed } = this.askQuestionConversation.find((q) => q.id === questionId) ?? {
      answer: '',
      confirmed: undefined,
    };
    return { answer, confirmed };
  }

  async answerQuestion(questionId: string, answer: string, confirmed: boolean | undefined): Promise<void> {
    if (this.currentQuestion && this.currentQuestion.id === questionId) {
      this.askQuestionConversation.push({
        id: this.currentQuestion.id,
        question: this.currentQuestion.text,
        answer: answer,
        confirmed,
        isConfirmation: this.currentQuestion.isConfirmation,
      });
      this.currentQuestion = null;
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

  async deleteIteration(iterationId: string): Promise<void> {
    const currentIterationId = this.executionStatus !== 'idle' ? this.content.slice(-1)[0]?.message?.iterationId : null;
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
          reject(new Error('Codegen execution was interrupted'));
        } else if (this.currentQuestion === null) {
          resolve();
        } else {
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
}
