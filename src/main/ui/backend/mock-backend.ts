// Simulated delay for API calls
const SIMULATED_DELAY = 1000;

// Simulated codegen execution time
const EXECUTION_TIME = 5000;

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

class MockBackend {
  private executionStatus: 'idle' | 'running' | 'paused' | 'completed' = 'idle';
  private currentPrompt: string | null = null;
  private promptHistory: string[] = [];
  private currentQuestion: Question | null = null;
  private codegenOutput: string = '';
  private askQuestionConversation: Array<{ question: string; answer: string }> = [];
  private functionCalls: FunctionCall[] = [];

  async executeCodegen(prompt: string): Promise<CodegenResult> {
    this.currentPrompt = prompt;
    this.executionStatus = 'running';
    this.promptHistory.push(prompt);

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
    this.codegenOutput = `Executed codegen for prompt: "${prompt}"`;
    this.functionCalls.push({
      name: 'executeCodegen',
      args: { prompt },
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

  async getPromptHistory(): Promise<string[]> {
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

  // New methods for storing and retrieving codegen output, ask-question conversation, and function calls

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
}

export const mockBackend = new MockBackend();
