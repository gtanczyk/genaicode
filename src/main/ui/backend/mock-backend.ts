// Simulated delay for API calls
const SIMULATED_DELAY = 1000;

// Simulated codegen execution time
const EXECUTION_TIME = 5000;

import { rcConfig as actualRcConfig } from '../../config.js';
import { CodegenOptions } from '../../codegen-types.js';

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

class MockBackend {
  private executionStatus: 'idle' | 'running' | 'paused' | 'completed' = 'idle';
  private currentPrompt: string | null = null;
  private promptHistory: PromptHistoryItem[] = [];
  private currentQuestion: Question | null = null;
  private codegenOutput: string = '';
  private askQuestionConversation: Array<{ question: string; answer: string }> = [];
  private functionCalls: FunctionCall[] = [];
  private codegenOptions: CodegenOptions;
  private rcConfig: typeof actualRcConfig;

  constructor() {
    this.codegenOptions = this.getDefaultCodegenOptions();
    this.rcConfig = { ...actualRcConfig };
  }

  async executeCodegen(prompt: string, options: CodegenOptions): Promise<CodegenResult> {
    this.currentPrompt = prompt;
    this.executionStatus = 'running';
    this.codegenOptions = { ...this.codegenOptions, ...options };
    const cost = this.calculatePromptCost(prompt);
    this.promptHistory.push({ prompt, cost });

    await this.simulateDelay(SIMULATED_DELAY);

    // Simulate a question being asked during execution
    if (Math.random() > 0.5) {
      this.currentQuestion = {
        id: Date.now().toString(),
        text: 'Do you want to proceed with the suggested changes?',
      };
      // Wait for the question to be answered before continuing
      await this.waitForQuestionAnswer();
    }

    await this.simulateDelay(EXECUTION_TIME);

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
    await this.simulateDelay(SIMULATED_DELAY);
    this.executionStatus = 'paused';
  }

  async resumeExecution(): Promise<void> {
    await this.simulateDelay(SIMULATED_DELAY);
    this.executionStatus = 'running';
  }

  async interruptExecution(): Promise<void> {
    await this.simulateDelay(SIMULATED_DELAY);
    this.executionStatus = 'idle';
    this.currentPrompt = null;
  }

  async getExecutionStatus(): Promise<string> {
    await this.simulateDelay(SIMULATED_DELAY);
    return this.executionStatus;
  }

  async getPromptHistory(): Promise<PromptHistoryItem[]> {
    await this.simulateDelay(SIMULATED_DELAY);
    return this.promptHistory;
  }

  async getCurrentQuestion(): Promise<Question | null> {
    await this.simulateDelay(SIMULATED_DELAY);
    return this.currentQuestion;
  }

  async answerQuestion(questionId: string, answer: string): Promise<void> {
    await this.simulateDelay(SIMULATED_DELAY);
    if (this.currentQuestion && this.currentQuestion.id === questionId) {
      this.askQuestionConversation.push({
        question: this.currentQuestion.text,
        answer: answer,
      });
      this.currentQuestion = null;
      console.log(`Answered question: ${answer}`);
    }
  }

  async getCodegenOutput(): Promise<string> {
    await this.simulateDelay(SIMULATED_DELAY);
    return this.codegenOutput;
  }

  async getAskQuestionConversation(): Promise<Array<{ question: string; answer: string }>> {
    await this.simulateDelay(SIMULATED_DELAY);
    return this.askQuestionConversation;
  }

  async getFunctionCalls(): Promise<FunctionCall[]> {
    await this.simulateDelay(SIMULATED_DELAY);
    return this.functionCalls;
  }

  async getTotalCost(): Promise<number> {
    await this.simulateDelay(SIMULATED_DELAY);
    return this.promptHistory.reduce((total, item) => total + item.cost, 0);
  }

  getDefaultCodegenOptions(): CodegenOptions {
    return {
      aiService: 'vertex-ai',
      explicitPrompt: undefined,
      taskFile: undefined,
      considerAllFiles: false,
      allowFileCreate: false,
      allowFileDelete: false,
      allowDirectoryCreate: false,
      allowFileMove: false,
      vision: false,
      imagen: undefined,
      disableContextOptimization: false,
      temperature: 0.7,
      cheap: false,
      dryRun: false,
      verbose: false,
      requireExplanations: false,
      geminiBlockNone: false,
      disableInitialLint: false,
      contentMask: undefined,
      ignorePatterns: undefined,
      askQuestion: true,
      interactive: true,
      disableCache: false,
      dependencyTree: false,
    };
  }

  async updateCodegenOptions(options: Partial<CodegenOptions>): Promise<void> {
    await this.simulateDelay(SIMULATED_DELAY);
    this.codegenOptions = { ...this.codegenOptions, ...options };
    console.log('Updated CodegenOptions:', this.codegenOptions);
  }

  async getRcConfig(): Promise<typeof actualRcConfig> {
    await this.simulateDelay(SIMULATED_DELAY);
    return this.rcConfig;
  }

  private simulateDelay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private waitForQuestionAnswer(): Promise<void> {
    return new Promise((resolve) => {
      const checkQuestion = () => {
        if (this.currentQuestion === null) {
          resolve();
        } else {
          setTimeout(checkQuestion, 1000);
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

export const mockBackend = new MockBackend();
