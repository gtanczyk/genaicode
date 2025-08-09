import Docker from 'dockerode';
import { FunctionCall, GenerateContentArgs, PromptItem } from '../../../../ai-service/common-types.js';
import { ActionHandlerProps, ActionResult } from '../step-ask-question-types.js';
import { putSystemMessage } from '../../../../main/common/content-bus.js';
import { ModelType } from '../../../../ai-service/common-types.js';
import { getFunctionDefs } from '../../../function-calling.js';
import {
  runCommandDef,
  completeTaskDef,
  failTaskDef,
  analyzeTaskDef,
  planStepsDef,
} from '../../../function-defs/container-task-commands.js';
import { pullImage, createAndStartContainer, executeCommand, stopContainer } from '../../../../utils/docker-utils.js';
import { registerActionHandler } from '../step-ask-question-handlers.js';
import { AllowedDockerImage } from '../../../function-defs/run-container-task.js';

/**
 * Task complexity levels for adaptive behavior
 */
export type TaskComplexity = 'simple' | 'medium' | 'complex';

/**
 * Execution phases for progressive command strategy
 */
export type ExecutionPhase = 'orientation' | 'preparation' | 'execution' | 'verification';

/**
 * Context management strategy based on task type
 */
export interface ContextStrategy {
  taskType: 'exploration' | 'build' | 'test' | 'debug' | 'simple';
  maxItems: number;
  outputLimit: number;
  summarizationRules: {
    keepPattern: RegExp[];
    summarizePattern: RegExp[];
    truncatePattern: RegExp[];
  };
}

/**
 * Arguments for the runContainerTask action
 */
export type RunContainerTaskArgs = {
  image: AllowedDockerImage;
  taskDescription: string;
};

/**
 * Arguments for the analyzeTask action in container tasks
 */
export type AnalyzeTaskArgs = {
  analysis: string;
  complexity: TaskComplexity;
  approach: string;
};

/**
 * Step definition for the plan
 */
export interface PlanStep {
  phase: ExecutionPhase;
  commands: string[];
  rationale: string;
  riskLevel: 'low' | 'medium' | 'high';
}

/**
 * Arguments for the planSteps action in container tasks
 */
export type PlanStepsArgs = {
  steps: PlanStep[];
};

/**
 * Arguments for the runCommand action in container tasks
 */
export type RunCommandArgs = {
  command: string;
  reasoning: string;
  phase: ExecutionPhase;
  expectedOutcome: string;
  fallbackCommand?: string;
};

/**
 * Arguments for the completeTask action in container tasks
 */
export type CompleteTaskArgs = {
  summary: string;
};

/**
 * Arguments for the failTask action in container tasks
 */
export type FailTaskArgs = {
  reason: string;
};

/**
 * Context management strategies based on task complexity
 */
const contextStrategies: Record<TaskComplexity, ContextStrategy> = {
  simple: {
    taskType: 'simple',
    maxItems: 20,
    outputLimit: 1024,
    summarizationRules: {
      keepPattern: [/error/i, /failed/i, /success/i],
      summarizePattern: [/^ls\s/, /^pwd/, /^echo/],
      truncatePattern: [/^cat\s/, /^head\s/, /^tail\s/],
    },
  },
  medium: {
    taskType: 'build',
    maxItems: 50,
    outputLimit: 2048,
    summarizationRules: {
      keepPattern: [/error/i, /failed/i, /success/i, /installed/i, /completed/i],
      summarizePattern: [/^ls\s/, /^pwd/, /^echo/, /^mkdir/],
      truncatePattern: [/^cat\s/, /^head\s/, /^tail\s/, /^log/],
    },
  },
  complex: {
    taskType: 'debug',
    maxItems: 80,
    outputLimit: 4096,
    summarizationRules: {
      keepPattern: [/error/i, /failed/i, /success/i, /installed/i, /completed/i, /warning/i],
      summarizePattern: [/^ls\s/, /^pwd/, /^echo/],
      truncatePattern: [/^log/, /^journal/],
    },
  },
};

registerActionHandler('runContainerTask', handleRunContainerTask);

export async function handleRunContainerTask({
  askQuestionCall,
  prompt,
  generateContentFn,
  options,
}: ActionHandlerProps): Promise<ActionResult> {
  try {
    putSystemMessage('Container task: generating proper task request');

    // First, use generateContentFn to get the proper runContainerTask arguments
    const request: GenerateContentArgs = [
      [
        ...prompt,
        {
          type: 'assistant',
          text: askQuestionCall.args!.message,
        },
      ],
      {
        functionDefs: getFunctionDefs(),
        requiredFunctionName: 'runContainerTask',
        temperature: 0.7,
        modelType: ModelType.CHEAP,
        expectedResponseType: {
          text: false,
          functionCall: true,
          media: false,
        },
      },
      options,
    ];

    const response = await generateContentFn(...request);
    const [runContainerTaskCall] = response
      .filter((item) => item.type === 'functionCall')
      .map((item) => item.functionCall) as [FunctionCall<RunContainerTaskArgs> | undefined];

    if (!runContainerTaskCall?.args?.image || !runContainerTaskCall.args.taskDescription) {
      putSystemMessage('❌ Failed to get valid runContainerTask request');

      prompt.push(
        {
          type: 'assistant',
          text: askQuestionCall.args!.message,
        },
        {
          type: 'user',
          text: 'Failed to get valid runContainerTask request',
        },
      );
      return { breakLoop: false, items: [] };
    }

    const { image, taskDescription } = runContainerTaskCall.args;
    const docker = new Docker({ socketPath: '/var/run/docker.sock' });

    putSystemMessage(`🐳 Starting container task with image: ${image}`);

    try {
      await pullImage(docker, image);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      putSystemMessage(`❌ Failed to pull Docker image: ${errorMessage}`);

      prompt.push(
        {
          type: 'assistant',
          text: askQuestionCall.args!.message,
          functionCalls: [runContainerTaskCall],
        },
        {
          type: 'user',
          functionResponses: [
            {
              name: 'runContainerTask',
              call_id: runContainerTaskCall.id || undefined,
              content: `Failed to pull Docker image: ${errorMessage}`,
            },
          ],
        },
      );
      return { breakLoop: false, items: [] };
    }

    let container: Docker.Container | undefined;
    try {
      container = await createAndStartContainer(docker, image);

      const { success, summary } = await commandExecutionLoop(container, taskDescription, generateContentFn, options);

      const finalMessage = `✅ Task finished with status: ${success ? 'Success' : 'Failed'}.

**Summary:**
${summary}`;

      putSystemMessage(finalMessage);

      prompt.push(
        {
          type: 'assistant',
          text: askQuestionCall.args!.message,
          functionCalls: [runContainerTaskCall],
        },
        {
          type: 'user',
          functionResponses: [
            {
              name: 'runContainerTask',
              call_id: runContainerTaskCall.id || undefined,
              content: finalMessage,
            },
          ],
        },
      );
      return { breakLoop: true, items: [] };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      putSystemMessage(`❌ An error occurred during the container task: ${errorMessage}`);

      prompt.push(
        {
          type: 'assistant',
          text: askQuestionCall.args!.message,
          functionCalls: [runContainerTaskCall],
        },
        {
          type: 'user',
          functionResponses: [
            {
              name: 'runContainerTask',
              call_id: runContainerTaskCall.id || undefined,
              content: `An error occurred during the container task: ${errorMessage}`,
            },
          ],
        },
      );
      return { breakLoop: false, items: [] };
    } finally {
      if (container) {
        await stopContainer(container);
      }
    }
  } catch (error) {
    // Handle errors gracefully
    const errorMessage = error instanceof Error ? error.message : String(error);
    putSystemMessage(`Error during container task initialization: ${errorMessage}`);

    prompt.push(
      {
        type: 'assistant',
        text: askQuestionCall.args!.message,
      },
      {
        type: 'user',
        text: `Error during container task initialization.`,
      },
    );

    return { breakLoop: true, items: [] };
  }
}

async function commandExecutionLoop(
  container: Docker.Container,
  taskDescription: string,
  generateContentFn: ActionHandlerProps['generateContentFn'],
  options: ActionHandlerProps['options'],
): Promise<{ success: boolean; summary: string }> {
  let success = false;
  let summary = '';
  const maxCommands = 25;
  const taskExecutionPrompt: PromptItem[] = [];

  // Phase 1: Think - Analyze the task
  const taskAnalysis = await analyzeTask(taskDescription, generateContentFn, options);
  if (!taskAnalysis) {
    return { success: false, summary: 'Failed to analyze task requirements' };
  }

  // Get adaptive context strategy based on complexity
  const contextStrategy = contextStrategies[taskAnalysis.complexity];

  putSystemMessage(`📊 Task Analysis: Complexity=${taskAnalysis.complexity}, Strategy=${contextStrategy.taskType}`);

  // Phase 2: Plan - Create execution plan
  const executionPlan = await createExecutionPlan(taskAnalysis, generateContentFn, options);
  if (!executionPlan) {
    return { success: false, summary: 'Failed to create execution plan' };
  }

  putSystemMessage(`📋 Created execution plan with ${executionPlan.steps.length} steps`);

  // Build the system prompt with advanced best practices
  const systemPrompt: PromptItem = {
    type: 'systemPrompt',
    systemPrompt: `You are an expert system operator inside a Docker container implementing a Think-Plan-Execute approach.

EXECUTION STRATEGY:
Your plan: ${JSON.stringify(executionPlan.steps, null, 2)}

BEST PRACTICES:
- Follow your planned approach but adapt as needed based on results
- Execute commands incrementally, validating results before proceeding
- Use progressive phases: orientation → preparation → execution → verification
- Be mindful of context size - keep outputs concise and relevant
- Provide clear reasoning for each command in context of your plan
- If a command fails, try the fallback command or adapt your approach

AVAILABLE FUNCTIONS:
- runCommand(command, reasoning, phase, expectedOutcome, fallbackCommand?): Execute a shell command
- completeTask(summary): Mark task as successfully completed
- failTask(reason): Mark task as failed

PHASE GUIDELINES:
- Orientation: Low-risk commands to understand the environment (pwd, ls, whoami)
- Preparation: Setup commands (mkdir, cd, install dependencies)  
- Execution: Core task commands (build, run, process)
- Verification: Validation commands (test, check, verify results)

Execute your plan step by step, adapting as needed based on actual results.`,
  };

  // Build the initial user message with task description and analysis
  const taskPrompt: PromptItem = {
    type: 'user',
    text: `Task: ${taskDescription}

Analysis: ${taskAnalysis.analysis}
Approach: ${taskAnalysis.approach}
Complexity: ${taskAnalysis.complexity}

Begin executing your planned approach. Start with orientation phase commands to understand the environment.`,
  };

  // Phase 3: Execute - Progressive command execution
  for (let i = 0; i < maxCommands; i++) {
    try {
      // Intelligent context management
      let currentPrompt = taskExecutionPrompt;
      if (currentPrompt.length > contextStrategy.maxItems) {
        currentPrompt = intelligentPruneContext(currentPrompt, contextStrategy);
      }

      const [actionResult] = (
        await generateContentFn(
          [systemPrompt, taskPrompt, ...currentPrompt],
          {
            functionDefs: [runCommandDef, completeTaskDef, failTaskDef],
            temperature: 0.7,
            modelType: ModelType.CHEAP,
            expectedResponseType: {
              text: true, // Allow text responses for reasoning
              functionCall: true,
              media: false,
            },
          },
          options,
        )
      )
        .filter((item) => item.type === 'functionCall')
        .map((item) => item.functionCall) as [
        FunctionCall<RunCommandArgs | CompleteTaskArgs | FailTaskArgs> | undefined,
      ];

      if (!actionResult) {
        putSystemMessage('❌ Internal LLM failed to produce a valid function call.');
        summary = 'Task failed: AI system could not determine next action';
        break;
      }

      if (actionResult.name === 'completeTask') {
        const args = actionResult.args as CompleteTaskArgs;
        putSystemMessage('✅ Task marked as complete by internal operator.');
        success = true;
        summary = args.summary;

        taskExecutionPrompt.push(
          {
            type: 'assistant',
            text: 'Task completed successfully.',
            functionCalls: [actionResult],
          },
          {
            type: 'user',
            functionResponses: [
              {
                name: 'completeTask',
                call_id: actionResult.id || undefined,
                content: 'Task completed successfully.',
              },
            ],
          },
        );
        break;
      }

      if (actionResult.name === 'failTask') {
        const args = actionResult.args as FailTaskArgs;
        putSystemMessage('❌ Task marked as failed by internal operator.');
        success = false;
        summary = args.reason;

        taskExecutionPrompt.push(
          {
            type: 'assistant',
            text: 'Task failed.',
            functionCalls: [actionResult],
          },
          {
            type: 'user',
            functionResponses: [
              {
                name: 'failTask',
                call_id: actionResult.id || undefined,
                content: 'Task marked as failed.',
              },
            ],
          },
        );
        break;
      }

      if (actionResult.name === 'runCommand') {
        const args = actionResult.args as RunCommandArgs;
        const { command, reasoning, phase, expectedOutcome, fallbackCommand } = args;

        if (i === maxCommands - 1) {
          putSystemMessage('⚠️ Reached maximum command limit.');
          summary = 'Task incomplete: Reached maximum command limit';
          break;
        }

        putSystemMessage(`[${phase.toUpperCase()}] Executing: \`${command}\``);
        putSystemMessage(`Reasoning: ${reasoning}`);
        putSystemMessage(`Expected: ${expectedOutcome}`);

        try {
          const { output, exitCode } = await executeCommand(container, command);

          // Apply context strategy for output management
          let managedOutput = output;
          if (output.length > contextStrategy.outputLimit) {
            managedOutput =
              output.slice(0, contextStrategy.outputLimit) + '\n\n[... output truncated for context management ...]';
            putSystemMessage(`⚠️ Output truncated (${output.length} -> ${managedOutput.length} chars)`);
          }

          taskExecutionPrompt.push(
            {
              type: 'assistant',
              text: `[${phase}] ${reasoning}`,
              functionCalls: [actionResult],
            },
            {
              type: 'user',
              functionResponses: [
                {
                  name: 'runCommand',
                  call_id: actionResult.id || undefined,
                  content: `Command executed. Phase: ${phase}\nExpected: ${expectedOutcome}\n\nOutput:\n${managedOutput}\n\nExit Code: ${exitCode}`,
                },
              ],
            },
          );

          // Check for command failure and try fallback if available
          if (exitCode !== 0 && fallbackCommand) {
            putSystemMessage(`⚠️ Command failed (exit code ${exitCode}), trying fallback: ${fallbackCommand}`);

            const fallbackResult = await executeCommand(container, fallbackCommand);
            let fallbackOutput = fallbackResult.output;

            if (fallbackOutput.length > contextStrategy.outputLimit) {
              fallbackOutput =
                fallbackOutput.slice(0, contextStrategy.outputLimit) +
                '\n\n[... output truncated for context management ...]';
            }

            taskExecutionPrompt.push({
              type: 'user',
              text: `Fallback command executed: ${fallbackCommand}\n\nOutput:\n${fallbackOutput}\n\nExit Code: ${fallbackResult.exitCode}`,
            });
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          putSystemMessage(`❌ Command execution failed: ${errorMessage}`);

          taskExecutionPrompt.push(
            {
              type: 'assistant',
              text: `[${phase}] ${reasoning}`,
              functionCalls: [actionResult],
            },
            {
              type: 'user',
              functionResponses: [
                {
                  name: 'runCommand',
                  call_id: actionResult.id || undefined,
                  content: `Command failed with error: ${errorMessage}`,
                },
              ],
            },
          );
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      putSystemMessage(`❌ Error during command execution loop: ${errorMessage}`);
      summary = `Task failed: Error during execution - ${errorMessage}`;
      break;
    }
  }

  if (!summary) {
    summary = success ? 'Task completed' : 'Task failed or incomplete';
  }

  return { success, summary };
}

/**
 * Phase 1: Analyze the task to understand requirements and complexity
 */
async function analyzeTask(
  taskDescription: string,
  generateContentFn: ActionHandlerProps['generateContentFn'],
  options: ActionHandlerProps['options'],
): Promise<AnalyzeTaskArgs | null> {
  try {
    const analysisPrompt: PromptItem[] = [
      {
        type: 'systemPrompt',
        systemPrompt: `You are an expert task analyst. Analyze the given task to understand:
1. What exactly needs to be accomplished
2. The complexity level (simple, medium, complex)
3. The high-level approach to take

Consider:
- Simple: Basic file operations, simple commands, single-step tasks
- Medium: Installation tasks, building software, multi-step workflows
- Complex: Debugging, complex setups, tasks requiring deep domain knowledge`,
      },
      {
        type: 'user',
        text: `Please analyze this task: ${taskDescription}`,
      },
    ];

    const [analysisResult] = (
      await generateContentFn(
        analysisPrompt,
        {
          functionDefs: [analyzeTaskDef],
          temperature: 0.3,
          modelType: ModelType.CHEAP,
          expectedResponseType: {
            text: false,
            functionCall: true,
            media: false,
          },
        },
        options,
      )
    )
      .filter((item) => item.type === 'functionCall')
      .map((item) => item.functionCall) as [FunctionCall<AnalyzeTaskArgs> | undefined];

    return analysisResult?.args || null;
  } catch (error) {
    putSystemMessage(`❌ Task analysis failed: ${error}`);
    return null;
  }
}

/**
 * Phase 2: Create detailed execution plan based on task analysis
 */
async function createExecutionPlan(
  taskAnalysis: AnalyzeTaskArgs,
  generateContentFn: ActionHandlerProps['generateContentFn'],
  options: ActionHandlerProps['options'],
): Promise<PlanStepsArgs | null> {
  try {
    const planningPrompt: PromptItem[] = [
      {
        type: 'systemPrompt',
        systemPrompt: `You are an expert execution planner. Create a detailed step-by-step plan for the task.

PHASES:
- orientation: Understand the environment (pwd, ls, whoami, check what's available)
- preparation: Setup and dependencies (mkdir, cd, install, configure)
- execution: Core task work (build, run, process, create)
- verification: Validate results (test, check, verify)

RISK LEVELS:
- low: Safe commands that won't break anything
- medium: Commands that modify system but are reversible
- high: Commands that could cause data loss or system issues

Create a comprehensive plan with clear rationale for each step.`,
      },
      {
        type: 'user',
        text: `Create an execution plan for this task:

Analysis: ${taskAnalysis.analysis}
Complexity: ${taskAnalysis.complexity}
Approach: ${taskAnalysis.approach}

Break this down into specific steps with commands, phases, and risk levels.`,
      },
    ];

    const [planResult] = (
      await generateContentFn(
        planningPrompt,
        {
          functionDefs: [planStepsDef],
          temperature: 0.5,
          modelType: ModelType.CHEAP,
          expectedResponseType: {
            text: false,
            functionCall: true,
            media: false,
          },
        },
        options,
      )
    )
      .filter((item) => item.type === 'functionCall')
      .map((item) => item.functionCall) as [FunctionCall<PlanStepsArgs> | undefined];

    return planResult?.args || null;
  } catch (error) {
    putSystemMessage(`❌ Plan creation failed: ${error}`);
    return null;
  }
}

/**
 * Intelligent context pruning based on strategy
 */
function intelligentPruneContext(history: PromptItem[], strategy: ContextStrategy): PromptItem[] {
  if (history.length <= strategy.maxItems) {
    return history;
  }

  putSystemMessage(`🧹 Pruning context: ${history.length} → ${strategy.maxItems} items`);

  // Keep first few items (initial context)
  const keepStart = 2;
  // Keep last several items (recent context)
  const keepEnd = Math.floor(strategy.maxItems * 0.4);
  // Calculate middle items to remove
  const middleStart = keepStart;
  const middleEnd = history.length - keepEnd;

  if (middleEnd <= middleStart) {
    return history.slice(0, strategy.maxItems);
  }

  return [
    ...history.slice(0, keepStart),
    {
      type: 'user',
      text: `[... ${middleEnd - middleStart} earlier items pruned for context management ...]`,
    },
    ...history.slice(-keepEnd),
  ];
}
