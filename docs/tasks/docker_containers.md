# 🐳 Docker Container Task Execution – Design Doc (MVP)

## 1. Problem Statement

GenAIcode cannot currently execute generated code safely. A mechanism to run complex, multi-step tasks within a sandboxed Docker environment is needed. The process should be self-contained, from container creation to task completion and cleanup, and provide a concise summary of the outcome.

## 2. Goals (MVP)

- ✅ Execute multi-step tasks safely in a Docker container using a single, self-contained action.
- ✅ Define a new action: `runContainerTask`.

### Out-of-Scope

- ❌ Advanced Docker configurations (e.g., volume mounts, environment variables).
- ❌ Real-time streaming of command outputs.
- ❌ Building Docker images.

---

## 3. System Overview

```
GenAIcode LLM
│ (via step-ask-question)
▼
GenAIcode Action Dispatcher
│
├─ existing handlers...
└─ 🆕 RunContainerTask Executor
   │
   ├─ 1. Start Container
   ├─ 2. Command Execution Loop (with internal LLM for next command)
   ├─ 3. Stop & Remove Container
   └─ 4. Summarize Result
   │
   ▼
   Local Docker Engine (via dockerode)
```

- The new action handler will be implemented as a new ask question action type.

---

## 4. Action Interface

### ✅ `runContainerTask`

| Input Args                   | Output                 |
| ---------------------------- | ---------------------- |
| `{ image, taskDescription }` | `{ success, summary }` |

- **`image`**: The Docker image to use (e.g., `ubuntu:latest`).
- **`taskDescription`**: A detailed, natural language description of the entire task to be performed. This guides the internal command execution loop.
- **`success`**: A boolean indicating if the overall task was completed successfully.
- **`summary`**: A concise, AI-generated summary of the task's outcome, including key results and errors.

---

## 5. Implementation Details

The `runContainerTask` executor will be a self-contained ask question action handler that performs the following steps:

### 5.1. Container Lifecycle Management

1.  **Instantiate Docker Client**: Connect to the local Docker daemon using `dockerode`.
2.  **Pull Image**: Ensure the specified `image` is available locally, pulling it if necessary.
3.  **Create and Start Container**:
    ```javascript
    const docker = new Docker({ socketPath: '/var/run/docker.sock' });
    const container = await docker.createContainer({
      Image: image,
      Tty: true, // Keep container running
      Cmd: ['/bin/sh'], // Start a shell
    });
    await container.start();
    ```
4.  **Cleanup**: After the task is finished (or on error), the executor will stop and remove the container.
    ```javascript
    await container.stop();
    await container.remove();
    ```

### 5.2. Command Execution Loop

This is the core of the executor. It will use an internal LLM call to decide the sequence of commands to run based on the `taskDescription`.

1.  **Initialize State**: Start with the initial `taskDescription` and an empty command history.
2.  **Loop**:
    a. **Get Next Command**: Make an internal `generateContent` call to a cheap model (e.g., Gemini Flash).

    - **Prompt**:

      ````
      You are an expert system operator inside a Docker container.
      Based on the overall task and the history of commands executed so far, determine the single next shell command to run.
      If the task is complete, respond with "TASK_COMPLETE".
      If you cannot determine the next step, respond with "TASK_FAILED".

           Overall Task:
           ${taskDescription}

           Command History (stdout/stderr):
           ${commandHistory}

           Next command:
           ```

      b. **Execute Command**: Run the generated command in the container using `docker.exec`.
      c. **Capture & Log Output**: Capture `stdout` and `stderr`, cap it to prevent excessive length, and append it to the session log and the `commandHistory`.
      d. **Check for Completion**: If the model returns `TASK_COMPLETE` or `TASK_FAILED`, exit the loop.
      ````

3.  **Task Finalization**: Once the loop terminates, the executor proceeds to the final summarization step.

---

## 6. Token Management & Summarization

- **Internal Loop**: The command generation loop will use a cheap, fast model to minimize latency and cost. The context for this internal LLM will be the task description and the history of command outputs.
- **Final Summary**: After the loop completes, a more capable model will be used to generate the final `summary` for the user.

  - **Prompt**:

    ```
    Based on the following task description and the full command log, provide a concise summary of the outcome.
    Highlight key results, successes, and any errors encountered.

    Task Description:
    ${taskDescription}

    Full Command Log:
    ${fullLog}

    Summary:
    ```

---

## 7. System Prompt Changes

The system prompt will be updated to inform the primary LLM about the new capability:

```
A new action is available for running complex tasks in an isolated environment:
• runContainerTask({ image, taskDescription })

Use this to execute multi-step command-line tasks. Provide a clear, step-by-step natural language description in `taskDescription`.
The action will handle starting the container, executing commands until the task is done, and cleaning up.
Example: "runContainerTask({ image: 'node:18', taskDescription: 'Clone the repository from https://github.com/example/project.git, run npm install, and then execute the test suite with npm test.' })"
```

---

## 8. Error Handling

- **Execution Errors**: If any shell command returns a non-zero exit code, the error will be logged and included in the context for the next command-generation step. The internal LLM can decide whether to continue or abort.
- **Container Errors**: Errors during container creation, start, or stop will cause the entire process to fail, returning a structured error message.
- **Loop Errors**: If the internal LLM returns `TASK_FAILED`, the loop terminates, and the task is marked as unsuccessful.

---

## 9. Security & Guidelines

- **Image Whitelist**: For added security, a configurable list of approved Docker images can be implemented.
- **Command Sanitization**: Input sanitization on the `taskDescription` is not the primary defense; the sandboxing is. However, monitoring for obviously malicious intent is a good practice.
- **Resource Limits**: The container should be run with resource constraints (CPU, memory) in a future iteration to prevent abuse.

---

## 11. Testing & Validation

- **Unit Tests**: Mock `dockerode` to simulate container and exec behavior. Mock `generateContent` for the internal loop to test a predefined sequence of commands (e.g., success path, error path).
- **Integration Tests**: Use Docker-in-Docker or a local Docker daemon to run a simple, real-world task (e.g., `git clone` and `ls`).
- **Validation**: Manually validate that for a given `taskDescription`, the generated commands are logical and the final summary is accurate.

---

## 12. Risk & Reevaluation

| Risk                        | Level  | Mitigation                                                              |
| --------------------------- | ------ | ----------------------------------------------------------------------- |
| Token cost (internal loop)  | Medium | Use a cheap, fast model (e.g., Gemini Flash) for command generation. ✅ |
| Infinite command loop       | Medium | Implement a max-command limit (e.g., 25 commands) as a safeguard.       |
| Security (untrusted images) | High   | Implement a configurable image whitelist. (Post-MVP)                    |
| Summarizer quality/accuracy | Low    | The user has access to the full log file for details.                   |

---

## 🎯 Final Recommendation

✅ Proceed with the MVP implementation of the `runContainerTask` action. It simplifies the user interaction and provides a more powerful, self-contained execution environment.

---

## 📚 Implementation Reference

This section documents how the Docker container task execution system works in practice, drawing from advanced AI assistant techniques for multi-step task execution, context management, and tool coordination.

### AI Assistant Architecture Patterns

The system follows proven patterns used by advanced AI assistants:

1. **Tool-First Approach**: Always prefer using available tools over manual implementation
2. **Iterative Validation**: Validate each step before proceeding to the next
3. **Context Awareness**: Continuously monitor and manage context size
4. **Graceful Degradation**: Handle errors and constraints elegantly

### Advanced Tool Coordination Techniques

#### Multi-Tool Workflows

Advanced AI assistants use coordinated tool sequences:

```typescript
// Pattern: Explore → Plan → Execute → Validate
1. str_replace_editor.view()     // Understand current state
2. think()                       // Plan approach
3. bash.command()               // Execute changes
4. bash.command()               // Validate results
```

#### Parallel Tool Execution

When operations are independent, execute simultaneously:

```typescript
// Instead of sequential calls:
view(file1) → view(file2) → view(file3)

// Use parallel execution:
[view(file1), view(file2), view(file3)]
```

### Context Management Strategies

#### Intelligent Truncation

Advanced assistants manage context proactively:

- **Output Limiting**: Cap command outputs at reasonable lengths (2048 chars)
- **History Pruning**: Keep first/last items, remove middle when context grows
- **Smart Summarization**: Replace verbose outputs with essential information
- **User Transparency**: Always notify when truncation occurs

#### Context Windows

```typescript
// Sliding window approach
const contextWindow = {
  systemPrompt: 'Always present',
  taskDescription: 'Always present',
  recentHistory: 'Last 10 interactions',
  middleHistory: 'Summarized or removed',
  currentState: 'Always present',
};
```

### Problem Decomposition Patterns

#### The Think-Plan-Execute Cycle

```typescript
1. think() → Analyze problem and plan approach
2. explore() → Gather necessary information
3. plan() → Create detailed step-by-step approach
4. execute() → Implement changes incrementally
5. validate() → Test and verify each change
6. iterate() → Refine based on results
```

#### Breaking Down Complex Tasks

Advanced assistants decompose tasks into atomic operations:

```typescript
// Large task: "Set up CI/CD pipeline"
// Decomposed into:
1. "Examine existing project structure"
2. "Identify testing framework"
3. "Create GitHub Actions workflow file"
4. "Configure build steps"
5. "Add deployment steps"
6. "Test workflow locally"
```

### Error Handling & Recovery

#### Graceful Failure Patterns

```typescript
// Pattern: Try → Detect → Recover → Continue
try {
  await executeCommand(command);
} catch (error) {
  // 1. Understand what went wrong
  await analyzeError(error);

  // 2. Try alternative approach
  await executeAlternativeCommand(fallbackCommand);

  // 3. Update mental model
  await updateContext("Learned that X doesn't work, using Y instead");
}
```

#### Progressive Fallbacks

- **First attempt**: Optimal solution
- **Second attempt**: Alternative approach
- **Third attempt**: Minimal viable solution
- **Final attempt**: Manual/user-guided approach

### Communication Patterns

#### When to Explain vs Act

Advanced assistants balance explanation with action:

```typescript
// Explain when:
- Task is complex/multi-step
- Approach might be surprising
- User needs to understand context
- Error recovery is happening

// Act directly when:
- Task is straightforward
- Pattern is well-established
- User prefers efficiency
- Action is clearly correct
```

#### Dual Response Mode

```typescript
// Combine reasoning with action:
{
  text: "I need to check the current file structure first, then modify the configuration",
  functionCalls: [
    { name: "str_replace_editor", args: { command: "view", path: "." } }
  ]
}
```

### Efficiency Techniques

#### Batch Operations

```typescript
// Instead of:
git add file1 → git add file2 → git add file3

// Use:
git add file1 file2 file3

// Or even better:
git add .
```

#### Smart Defaults

- **Auto-detect**: Framework, language, patterns from codebase
- **Convention over configuration**: Follow established patterns
- **Minimal changes**: Prefer small, surgical modifications
- **Idempotent operations**: Safe to run multiple times

### Container-Specific Applications

#### System Prompt Design

The container AI operator uses these principles:

```
You are an expert system operator. Apply advanced AI assistant techniques:

🎯 Tool-First: Use available commands efficiently
🔄 Iterate: Check results before proceeding
📏 Context-Aware: Keep outputs concise and relevant
🛡️ Robust: Handle errors gracefully with fallbacks
💡 Smart: Plan ahead but adapt based on results
```

#### Intelligent Command Selection

```typescript
// Progressive command strategy:
1. Start with info-gathering: pwd, ls, ps
2. Make minimal test changes: touch, echo
3. Proceed with main operations: install, build
4. Validate results: test, check logs
5. Clean up if needed: rm temp files
```

This approach mirrors how advanced AI assistants handle complex, multi-step tasks while maintaining reliability and efficiency.

### Practical Session Management

#### Task Execution Patterns

Advanced AI assistants follow consistent execution patterns:

```typescript
// 1. Understand → 2. Plan → 3. Execute → 4. Validate
const executionCycle = {
  understand: () => gatherContext(), // What's the current state?
  plan: () => decomposeTask(), // What steps are needed?
  execute: () => runCommands(), // How to implement each step?
  validate: () => checkResults(), // Did it work as expected?
};
```

#### Smart Command Sequencing

```typescript
// Pattern: Safe → Progressive → Comprehensive
const commandStrategy = [
  // Phase 1: Orientation (low risk)
  'pwd && ls -la', // Where am I? What's here?
  'which python && python --version', // What tools are available?

  // Phase 2: Preparation (medium risk)
  'mkdir -p workspace && cd workspace', // Set up safe working area
  'git clone <repo> && cd <repo>', // Get the code

  // Phase 3: Execution (high value)
  'npm install', // Install dependencies
  'npm test', // Run the actual task

  // Phase 4: Verification (critical)
  "echo $? && echo 'Exit code above'", // Check if it worked
];
```

#### Dynamic Context Adaptation

```typescript
// Adaptive context management based on task complexity
const manageContext = (history, task) => {
  if (task.isExploration) {
    // Keep more history for complex debugging
    return keepRecentItems(history, 40);
  } else if (task.isRepetitive) {
    // Compress repeated patterns
    return summarizePatterns(history, 20);
  } else {
    // Standard pruning for normal tasks
    return intelligentPrune(history, 30);
  }
};
```

#### Error Recovery Workflows

```typescript
// Multi-level error handling
const handleError = async (error, context) => {
  // Level 1: Immediate retry with slight variation
  if (error.type === 'transient') {
    return await retryWithDelay(originalCommand, 2000);
  }

  // Level 2: Alternative approach
  if (error.type === 'approach') {
    return await tryAlternativeMethod(context.alternatives);
  }

  // Level 3: Graceful degradation
  if (error.type === 'fundamental') {
    return await fallbackToSimpler(context.minimalGoal);
  }

  // Level 4: Human guidance
  return await requestUserInput(error, context);
};
```

### Key AI Assistant Design Principles

#### Tool Selection Strategy

Advanced assistants prioritize tools by effectiveness:

```typescript
const toolPriority = {
  // Tier 1: Ecosystem tools (highest reliability)
  ecosystem: ['npm install', 'pip install', 'cargo build'],

  // Tier 2: Standard utilities (high reliability)
  standard: ['git', 'curl', 'grep', 'find', 'sed'],

  // Tier 3: Manual operations (lower reliability)
  manual: ['custom scripts', 'complex pipes', 'manual parsing'],
};

// Always prefer higher tiers when available
```

#### Function Calls vs Text Processing

Why structured responses outperform text parsing:

- **Reliability**: `{ command: "ls -la" }` vs parsing "I'll run `ls -la`"
- **Type Safety**: Arguments validated at runtime
- **Extensibility**: Easy to add new capabilities
- **Debugging**: Clear audit trail of actions taken
- **Composability**: Functions can be chained and combined

#### Intelligent Decomposition

How advanced assistants break down complex tasks:

```typescript
// Example: "Set up a React project with TypeScript and testing"
const taskDecomposition = {
  analyze: ['Check if Node.js is available', 'Determine best scaffolding tool (create-react-app, Vite, etc.)'],

  scaffold: ['Run scaffolding command with TypeScript template', 'Verify project structure was created correctly'],

  enhance: [
    'Add testing framework (Jest, Vitest, etc.)',
    'Configure linting and formatting',
    'Set up basic component structure',
  ],

  validate: [
    'Run build to ensure everything compiles',
    'Run tests to verify setup works',
    'Check that dev server starts successfully',
  ],
};
```

#### Context Efficiency Patterns

Advanced assistants maximize context utility:

```typescript
// Information density optimization
const contextOptimization = {
  // High value: Recent outputs, current state, error messages
  keep: (item) => item.isRecent || item.isError || item.isState,

  // Medium value: Successful intermediate steps
  summarize: (item) => item.isSuccess && item.isIntermediate,

  // Low value: Verbose outputs, repeated patterns
  truncate: (item) => item.isVerbose || item.isRepeated,
};
```

#### Adaptive Behavior

How assistants adjust their approach based on context:

```typescript
const adaptiveBehavior = {
  // Fast iteration for simple tasks
  simple: {
    commands: ['quick', 'direct'],
    validation: 'minimal',
    explanation: 'brief',
  },

  // Careful progression for complex tasks
  complex: {
    commands: ['incremental', 'validated'],
    validation: 'comprehensive',
    explanation: 'detailed',
  },

  // Recovery mode for error situations
  recovery: {
    commands: ['diagnostic', 'alternative'],
    validation: 'extensive',
    explanation: 'explanatory',
  },
};
```

### Safety & Constraint Management

#### Multi-Layer Safety Approach

Advanced AI assistants implement defense in depth:

```typescript
const safetyLayers = {
  // Layer 1: Input validation
  validation: {
    imageAllowlist: ['ubuntu:latest', 'alpine:latest', 'node:18'],
    commandBlacklist: ['rm -rf /', 'dd if=/dev/zero', 'fork bomb'],
    resourceLimits: { maxCommands: 25, maxTime: '30min' },
  },

  // Layer 2: Runtime monitoring
  monitoring: {
    outputSizeLimit: 2048,
    contextSizeLimit: 50,
    errorThresholdLimit: 5,
  },

  // Layer 3: Graceful degradation
  degradation: {
    onResourceExhaustion: 'switch to minimal mode',
    onRepeatedFailures: 'request human intervention',
    onContextOverflow: 'intelligent pruning',
  },
};
```

#### Operational Constraints

Real-world constraints that shape assistant behavior:

```typescript
const operationalConstraints = {
  // Performance constraints
  performance: {
    responseTime: '<30s preferred',
    tokenEfficiency: 'minimize context waste',
    resourceUsage: 'clean up after tasks',
  },

  // Reliability constraints
  reliability: {
    errorRecovery: 'multiple fallback strategies',
    idempotency: 'safe to retry operations',
    stateManagement: 'always know current state',
  },

  // User experience constraints
  userExperience: {
    transparency: 'explain significant decisions',
    predictability: 'consistent behavior patterns',
    efficiency: 'minimize user waiting time',
  },
};
```

#### Container Security Model

Specific security considerations for container operations:

```typescript
const containerSecurity = {
  // Image security
  images: {
    allowedSources: 'official Docker Hub images only',
    versionPinning: 'prefer specific tags over "latest"',
    scanningPolicy: 'vulnerability scanning recommended',
  },

  // Runtime security
  runtime: {
    networkIsolation: 'no external network access',
    volumeMounting: 'read-only mounts preferred',
    privilegeEscalation: 'never run as root if avoidable',
  },

  // Lifecycle security
  lifecycle: {
    automaticCleanup: 'always stop and remove containers',
    logRetention: 'preserve execution logs for debugging',
    resourceLimits: 'prevent resource exhaustion attacks',
  },
};
```

This comprehensive approach ensures that AI-driven container operations remain both powerful and safe, following the same principles that govern advanced AI assistant behavior in production environments.
