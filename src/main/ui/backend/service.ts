import { rcConfig } from '../../config.js';
import { CodegenOptions } from '../../codegen-types.js';
import { RcConfig } from '../../config-lib.js';
import { runCodegenWorker, abortController } from '../../interactive/codegen-worker.js';
import { ContentProps } from '../../common/content-bus-types.js';

interface CodegenResult {
  success: boolean;
}

interface Question {
  id: string;
  text: string;
}

export class Service {
  private executionStatus: 'idle' | 'running' | 'paused' | 'completed' = 'idle';
  private currentQuestion: Question | null = null;
  private askQuestionConversation: Array<{ id: string; question: string; answer: string }> = [];
  private codegenOptions: CodegenOptions;
  private content: ContentProps[] = [];

  constructor(codegenOptions: CodegenOptions) {
    this.codegenOptions = codegenOptions;
  }

  async executeCodegen(prompt: string, options: CodegenOptions): Promise<CodegenResult> {
    this.executionStatus = 'running';
    this.codegenOptions = { ...this.codegenOptions, ...options };

    try {
      await runCodegenWorker({ ...options, explicitPrompt: prompt, considerAllFiles: true });
      this.executionStatus = 'completed';
    } catch (error) {
      console.error('Error executing codegen:', error);
      this.executionStatus = 'idle';
    }

    return {
      success: true,
    };
  }

  async pauseExecution(): Promise<void> {
    this.executionStatus = 'paused';
  }

  async resumeExecution(): Promise<void> {
    this.executionStatus = 'running';
  }

  async interruptExecution(): Promise<void> {
    abortController?.abort();
    this.executionStatus = 'idle';
  }

  async getExecutionStatus(): Promise<string> {
    return this.executionStatus;
  }

  async getCurrentQuestion(): Promise<Question | null> {
    return this.currentQuestion;
  }

  async askQuestion(question: string): Promise<string> {
    console.log('Ask question:', question);
    const questionId = Date.now().toString();
    this.currentQuestion = {
      id: questionId,
      text: question,
    };

    await this.waitForQuestionAnswer();

    console.log('Question answer wait finished.');
    return this.askQuestionConversation.find((question) => question.id === questionId)?.answer ?? '';
  }

  async answerQuestion(questionId: string, answer: string): Promise<void> {
    if (this.currentQuestion && this.currentQuestion.id === questionId) {
      this.askQuestionConversation.push({
        id: this.currentQuestion.id,
        question: this.currentQuestion.text,
        answer: answer,
      });
      this.currentQuestion = null;
      console.log(`Answered question: ${answer}`);
    }
  }

  handleContent(content: ContentProps): void {
    this.content.push(content);
  }

  getContent(): ContentProps[] {
    return this.content;
  }

  async getTotalCost(): Promise<number> {
    return this.content.reduce((total, item) => total + (item.cost ?? 0), 0);
  }

  getCodegenOptions() {
    return this.codegenOptions;
  }

  async getRcConfig(): Promise<RcConfig> {
    return rcConfig;
  }

  private waitForQuestionAnswer(): Promise<void> {
    return new Promise((resolve) => {
      const checkQuestion = () => {
        if (this.currentQuestion === null || abortController?.signal.aborted) {
          resolve();
        } else {
          setTimeout(checkQuestion, 100);
        }
      };
      checkQuestion();
    });
  }
}
