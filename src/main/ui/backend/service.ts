import { rcConfig } from '../../config.js';
import { CodegenOptions } from '../../codegen-types.js';
import { RcConfig } from '../../config-lib.js';
import { runCodegenWorker, abortController } from '../../interactive/codegen-worker.js';

interface CodegenResult {
  success: boolean;
  output: string;
}

interface Question {
  id: string;
  text: string;
}

interface FunctionCall {
  name: string;
  args: Record<string, unknown>;
}

interface PromptHistoryItem {
  prompt: string;
  cost: number;
}

export class Service {
  private executionStatus: 'idle' | 'running' | 'paused' | 'completed' = 'idle';
  private currentPrompt: string | null = null;
  private promptHistory: PromptHistoryItem[] = [];
  private currentQuestion: Question | null = null;
  private codegenOutput: string = '';
  private askQuestionConversation: Array<{ id: string; question: string; answer: string }> = [];
  private functionCalls: FunctionCall[] = [];
  private codegenOptions: CodegenOptions;

  constructor(codegenOptions: CodegenOptions) {
    this.codegenOptions = codegenOptions;
  }

  async executeCodegen(prompt: string, options: CodegenOptions): Promise<CodegenResult> {
    this.currentPrompt = prompt;
    this.executionStatus = 'running';
    this.codegenOptions = { ...this.codegenOptions, ...options };
    const cost = this.calculatePromptCost(prompt);
    this.promptHistory.push({ prompt, cost });

    await runCodegenWorker({ ...options, explicitPrompt: prompt, considerAllFiles: true });

    this.executionStatus = 'completed';
    this.codegenOutput = `Executed codegen for prompt: "${prompt}" with options: ${JSON.stringify(this.codegenOptions)}`;
    this.functionCalls.push({
      name: 'executeCodegen',
      args: { prompt, options: this.codegenOptions },
    });

    return {
      success: true,
      output: this.codegenOutput,
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
    this.currentPrompt = null;
  }

  async getExecutionStatus(): Promise<string> {
    return this.executionStatus;
  }

  async getPromptHistory(): Promise<PromptHistoryItem[]> {
    return this.promptHistory;
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

  async getCodegenOutput(): Promise<string> {
    return this.codegenOutput;
  }

  async getAskQuestionConversation(): Promise<Array<{ question: string; answer: string }>> {
    return this.askQuestionConversation;
  }

  async getFunctionCalls(): Promise<FunctionCall[]> {
    return this.functionCalls;
  }

  async getTotalCost(): Promise<number> {
    return this.promptHistory.reduce((total, item) => total + item.cost, 0);
  }

  getCodegenOptions() {
    return this.codegenOptions;
  }

  async updateCodegenOptions(options: Partial<CodegenOptions>): Promise<void> {
    this.codegenOptions = { ...this.codegenOptions, ...options };
    console.log('Updated CodegenOptions:', this.codegenOptions);
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

  private calculatePromptCost(prompt: string): number {
    // Simple mock implementation: cost is based on prompt length
    const baseCost = 0.01; // $0.01 per token
    const estimatedTokens = Math.ceil(prompt.length / 4); // Rough estimate: 1 token ≈ 4 characters
    return parseFloat((baseCost * estimatedTokens).toFixed(4));
  }
}
