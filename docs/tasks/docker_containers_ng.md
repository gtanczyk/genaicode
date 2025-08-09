# Docker Containers Next Generation (NG) - Refactoring Plan

## Overview

This document analyzes the current `runContainerTask` implementation against the advanced AI assistant techniques outlined in the implementation reference, identifies key gaps, and provides a comprehensive refactoring plan to align with best practices.

## Current Implementation Analysis

### ✅ What's Working Well

1. **Function Call Architecture**: Proper structured function definitions (runCommand, completeTask, failTask)
2. **Docker Utilities**: Clean separation of Docker operations in dedicated utility module
3. **Basic Context Management**: Implements output truncation (2048 chars) and conversation limits (50 items)
4. **Type Safety**: Strong typing with AllowedDockerImage enum and proper argument validation
5. **Container Lifecycle**: Proper container creation, execution, and cleanup
6. **Two-Level Architecture**: Main LLM generates task, internal operator executes commands
7. **Basic Error Handling**: Try-catch blocks with container cleanup

### ❌ Critical Gaps Identified

#### 1. Missing Think-Plan-Execute Cycle

**Current**: Direct command execution without planning
**Reference**: Explicit planning phase with task decomposition

```typescript
// Current approach
runCommand("ls -la") → runCommand("install dependencies") → ...

// Reference approach
think() → plan() → execute() → validate() → iterate()
```

#### 2. No Adaptive Behavior

**Current**: Fixed behavior regardless of task complexity
**Reference**: Context-aware adaptation based on task type

```typescript
// Missing adaptive strategies
const adaptiveBehavior = {
  simple: { commands: 'direct', validation: 'minimal' },
  complex: { commands: 'incremental', validation: 'comprehensive' },
  recovery: { commands: 'diagnostic', validation: 'extensive' },
};
```

#### 3. Limited Error Recovery

**Current**: Single-level error handling with task failure
**Reference**: Multi-level progressive fallbacks

```typescript
// Current: Immediate failure
catch (error) { failTask(error.message); }

// Reference: Progressive recovery
Level 1: Retry with variation
Level 2: Alternative approach
Level 3: Graceful degradation
Level 4: Human guidance
```

#### 4. Basic Context Management

**Current**: Fixed truncation rules
**Reference**: Dynamic context adaptation based on task needs

```typescript
// Current: Static limits
maxContextItems = 50;
maxOutputLength = 2048;

// Reference: Dynamic adaptation
if (task.isExploration) return keepRecentItems(history, 40);
if (task.isRepetitive) return summarizePatterns(history, 20);
```

#### 5. No Smart Command Sequencing

**Current**: Sequential command execution
**Reference**: Progressive strategy with safety phases

```typescript
// Missing: Phase-based execution
Phase 1: Orientation (pwd, ls) - LOW RISK
Phase 2: Preparation (mkdir, clone) - MEDIUM RISK
Phase 3: Execution (install, build) - HIGH VALUE
Phase 4: Verification (test, check) - CRITICAL
```

#### 6. Limited Tool Coordination

**Current**: Single command per iteration
**Reference**: Multi-tool workflows and parallel execution

```typescript
// Missing: Batch operations and tool prioritization
Tier 1: Ecosystem tools (npm install, pip install)
Tier 2: Standard utilities (git, curl, grep)
Tier 3: Manual operations (custom scripts)
```

## Refactoring Plan

### Phase 1: Core Architecture Enhancement

#### 1.1 Implement Think-Plan-Execute Framework

```typescript
// New function definitions needed
analyzeTaskDef: FunctionDef = {
  name: 'analyzeTask',
  description: 'Analyze the task and understand requirements',
  parameters: {
    analysis: string, // What needs to be accomplished?
    complexity: 'simple' | 'medium' | 'complex',
    approach: string, // Initial strategy
  },
};

planStepsDef: FunctionDef = {
  name: 'planSteps',
  description: 'Create detailed step-by-step execution plan',
  parameters: {
    steps: Array<{
      phase: 'orientation' | 'preparation' | 'execution' | 'verification';
      commands: string[];
      rationale: string;
      riskLevel: 'low' | 'medium' | 'high';
    }>,
  },
};
```

#### 1.2 Add Progressive Command Strategy

```typescript
// Enhanced runCommand with phases
runCommandDef: FunctionDef = {
  name: 'runCommand',
  parameters: {
    command: string,
    reasoning: string,
    phase: 'orientation' | 'preparation' | 'execution' | 'verification',
    expectedOutcome: string,  // What should this command achieve?
    fallbackCommand?: string  // Alternative if this fails
  }
}
```

#### 1.3 Implement Adaptive Context Management

```typescript
interface ContextStrategy {
  taskType: 'exploration' | 'build' | 'test' | 'debug' | 'simple';
  maxItems: number;
  outputLimit: number;
  summarizationRules: {
    keepPattern: RegExp[];
    summarizePattern: RegExp[];
    truncatePattern: RegExp[];
  };
}

const contextStrategies: Record<TaskComplexity, ContextStrategy> = {
  simple: { maxItems: 20, outputLimit: 1024, ... },
  complex: { maxItems: 50, outputLimit: 2048, ... },
  debug: { maxItems: 80, outputLimit: 4096, ... }
};
```

### Phase 2: Advanced Error Handling

#### 2.1 Multi-Level Error Recovery

```typescript
// New error recovery functions
retryCommandDef: FunctionDef = {
  name: 'retryCommand',
  description: 'Retry failed command with modifications',
  parameters: {
    originalCommand: string,
    modification: string,
    reasoning: string
  }
}

switchApproachDef: FunctionDef = {
  name: 'switchApproach',
  description: 'Try alternative method for the same goal',
  parameters: {
    originalGoal: string,
    newApproach: string,
    reasoning: string
  }
}

requestGuidanceDef: FunctionDef = {
  name: 'requestGuidance',
  description: 'Request human intervention for complex issues',
  parameters: {
    issue: string,
    attemptedSolutions: string[],
    suggestedNextSteps: string[]
  }
}
```

#### 2.2 Error Analysis and Learning

```typescript
interface ErrorContext {
  command: string;
  exitCode: number;
  output: string;
  errorType: 'transient' | 'approach' | 'fundamental' | 'environment';
  recoveryAttempts: number;
  suggestedAlternatives: string[];
}

// Error classification logic
const classifyError = (error: ErrorContext): ErrorRecoveryStrategy => {
  if (error.exitCode === 127) return 'command_not_found';
  if (error.output.includes('permission denied')) return 'permission_issue';
  if (error.output.includes('network')) return 'connectivity_issue';
  // ... more classification rules
};
```

### Phase 3: Tool Coordination & Batching

#### 3.1 Batch Command Support

```typescript
runBatchCommandsDef: FunctionDef = {
  name: 'runBatchCommands',
  description: 'Execute multiple related commands efficiently',
  parameters: {
    commands: Array<{
      command: string;
      reasoning: string;
      canFailSafely: boolean;
    }>,
    batchReasoning: string,
  },
};
```

#### 3.2 Smart Tool Selection

```typescript
interface ToolStrategy {
  goal: string;
  preferredTools: Array<{
    tool: string;
    command: string;
    reliability: 'high' | 'medium' | 'low';
    fallback?: string;
  }>;
}

// Example: Installing Node.js dependencies
const installDepsStrategy: ToolStrategy = {
  goal: 'install_dependencies',
  preferredTools: [
    { tool: 'npm', command: 'npm ci', reliability: 'high', fallback: 'npm install' },
    { tool: 'yarn', command: 'yarn install --frozen-lockfile', reliability: 'high' },
    { tool: 'manual', command: 'manual dependency resolution', reliability: 'low' },
  ],
};
```

### Phase 4: Advanced Context & Performance

#### 4.1 Intelligent Context Pruning

```typescript
interface ContextItem {
  content: string;
  type: 'command' | 'output' | 'error' | 'success' | 'analysis';
  importance: number; // 1-10 scale
  timestamp: Date;
  relatedTo: string[]; // Related command IDs
}

const intelligentPrune = (history: ContextItem[], targetSize: number): ContextItem[] => {
  // Keep high-importance items
  const critical = history.filter((item) => item.importance >= 8);

  // Keep recent items
  const recent = history.slice(-10);

  // Summarize middle content
  const summarized = summarizeMiddleContent(history, critical, recent);

  return [...critical, ...summarized, ...recent].slice(0, targetSize);
};
```

#### 4.2 Performance Monitoring

```typescript
interface PerformanceMetrics {
  commandCount: number;
  executionTime: number;
  contextSize: number;
  errorRate: number;
  resourceUsage: {
    memory: number;
    cpu: number;
    disk: number;
  };
}

const monitorPerformance = (metrics: PerformanceMetrics): void => {
  if (metrics.commandCount > 20) suggestBatching();
  if (metrics.executionTime > 300000) suggestOptimization(); // 5 min
  if (metrics.errorRate > 0.3) suggestStrategy();
};
```

### Phase 5: Enhanced Safety & Monitoring

#### 5.1 Advanced Safety Policies

```typescript
interface SafetyPolicy {
  maxExecutionTime: number;
  maxDiskUsage: number;
  allowedNetworkAccess: boolean;
  commandBlacklist: RegExp[];
  resourceLimits: {
    memory: string;
    cpu: string;
    pids: number;
  };
}

const safetyPolicies: Record<AllowedDockerImage, SafetyPolicy> = {
  'ubuntu:latest': {
    maxExecutionTime: 1800000, // 30 min
    maxDiskUsage: 1000000000, // 1GB
    allowedNetworkAccess: true,
    commandBlacklist: [/rm\s+-rf\s+\//, /dd\s+if=\/dev\/zero/],
    resourceLimits: { memory: '512m', cpu: '1.0', pids: 100 },
  },
  // ... other images
};
```

#### 5.2 Real-time Monitoring

```typescript
interface ContainerMonitor {
  checkResourceUsage(): Promise<ResourceUsage>;
  detectInfiniteLoops(): Promise<boolean>;
  validateOutputSanity(): Promise<boolean>;
  estimateRemainingTime(): Promise<number>;
}

const createContainerMonitor = (container: Docker.Container): ContainerMonitor => ({
  checkResourceUsage: async () => {
    const stats = await container.stats({ stream: false });
    return parseResourceStats(stats);
  },

  detectInfiniteLoops: async () => {
    // Check for repeated patterns in output
    // Check for high CPU with no progress
    return false; // Implementation needed
  },

  // ... other monitoring functions
});
```

## Implementation Priority

### High Priority (Immediate Impact)

1. **Think-Plan-Execute Cycle** - Core architectural improvement
2. **Progressive Error Recovery** - Reliability enhancement
3. **Adaptive Context Management** - Performance optimization
4. **Smart Command Sequencing** - Safety and efficiency

### Medium Priority (Quality Improvements)

1. **Batch Command Support** - Efficiency enhancement
2. **Advanced Safety Policies** - Security hardening
3. **Performance Monitoring** - Operational insights
4. **Tool Selection Strategy** - Reliability improvement

### Low Priority (Advanced Features)

1. **Real-time Container Monitoring** - Advanced diagnostics
2. **Machine Learning Context Optimization** - Future enhancement
3. **Parallel Command Execution** - Complex coordination
4. **Dynamic Resource Scaling** - Advanced resource management

## Migration Strategy

### Step 1: Backward Compatible Extensions

- Add new function definitions alongside existing ones
- Implement adaptive context management with current fallbacks
- Add progressive error recovery with current error handling as final fallback

### Step 2: Enhanced System Prompts

- Update system prompt to include planning instructions
- Add best practices guidance from implementation reference
- Enable both old and new execution patterns

### Step 3: Gradual Feature Rollout

- Implement think-plan-execute for complex tasks only
- Add batch commands for specific use cases
- Enable advanced error recovery for specific error types

### Step 4: Full Migration

- Make new patterns the default behavior
- Remove deprecated function definitions
- Update all related documentation and tests

## Success Metrics

1. **Reliability**: Reduce task failure rate by 40%
2. **Efficiency**: Decrease average execution time by 25%
3. **Context Management**: Reduce context overflow incidents by 80%
4. **Error Recovery**: Increase successful error recovery by 60%
5. **User Experience**: Improve task completion satisfaction scores

## Risk Assessment

### High Risk

- **Breaking Changes**: New function definitions might break existing integrations
- **Complexity**: Advanced features may introduce new failure modes
- **Performance**: Additional overhead from monitoring and analysis

### Mitigation Strategies

- **Feature Flags**: Enable new features gradually
- **Comprehensive Testing**: Extensive E2E testing before rollout
- **Fallback Mechanisms**: Always maintain backward compatibility
- **Monitoring**: Real-time monitoring of new feature performance

## Conclusion

The current implementation provides a solid foundation but lacks the sophisticated patterns used by advanced AI assistants. This refactoring plan addresses critical gaps in planning, error recovery, context management, and tool coordination while maintaining backward compatibility and operational safety.

The phased approach ensures manageable implementation while delivering incremental value at each stage. Priority should be given to the Think-Plan-Execute cycle and progressive error recovery as these provide the highest impact improvements to reliability and user experience.
