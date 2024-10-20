# Context Optimization Feature Implementation Plan

## Overview

This document outlines the plan for implementing a new context optimization feature in the GenAIcode prompt service. The feature aims to reduce the initial context size by summarizing file contents and determining their relevance to the user's prompt.

## Objectives

1. Reduce token usage in the initial context.
2. Improve efficiency of the AI service by focusing on relevant files.
3. Implement the feature as a separate step before the "ask question" step.

## Implementation Steps

### 1. Create a new file: `step-context-optimization.ts`

- Location: `/src/prompt/steps/step-context-optimization.ts`
- Purpose: Implement the context optimization logic

### 2. Implement the context optimization step

- Create a function `executeStepContextOptimization`
- Parameters:
  - `generateContentFn`: The AI service function to use
  - `prompt`: The user's prompt
  - `sourceCode`: The initial source code object
  - `options`: CodegenOptions

### 3. Context optimization logic

- For each file in the source code:
  - Generate a summary (1 sentence)
  - Rate the probability of relevance to the user's prompt (0-1)
- Use the cheap mode of the AI service for this step
- Return an optimized source code object with summaries and relevance scores

### 4. Update `prompt-service.ts`

- Import the new `executeStepContextOptimization` function
- Add a new step in the `promptService` function to call `executeStepContextOptimization`
- Use the optimized source code for the subsequent `getSourceCode` function call
- Implement a warning mechanism if the cheap model doesn't provide useful summaries

### 5. Error Handling and Fallback

- Implement a warning system using `putSystemMessage` when summaries are not useful
- Ensure the process continues even if optimization fails

### 6. Testing

- Create unit tests for the new `executeStepContextOptimization` function
- Update existing tests in `prompt-service.test.ts` to account for the new step

### 7. Documentation

- Update the main README.md to mention the new context optimization feature
- Add inline documentation to the new and modified functions

## Timeline

1. Implementation of `step-context-optimization.ts`: 2 hours
2. Integration with `prompt-service.ts`: 1 hour
3. Testing and debugging: 2 hours
4. Documentation updates: 1 hour

Total estimated time: 6 hours

## Future Improvements

- Fine-tune the relevance scoring algorithm
- Allow users to configure the threshold for file inclusion
- Implement caching of file summaries for frequently used files
