# Context Shrinking Feature Implementation Plan

## 1. Overview

The context shrinking feature aims to implement a token-aware nudge mechanism in the step-ask-question flow of the GenAIcode project. This feature will help manage the token count of conversations, automatically suggesting and applying context reductions when necessary to optimize performance and avoid hitting token limits.

## 2. Implementation Details

### 2.1 Token Estimation

- Utilize the existing token estimator located in `src/prompt/token-estimator.ts`.
- This estimator will be used to calculate the current token count of the conversation.

### 2.2 Threshold Setting

- Implement an initial fixed threshold of 4000 tokens.
- This threshold will be used to determine when context reduction should be triggered.

### 2.3 Nudge Mechanism

- Check the token count after each exchange in the conversation.
- Trigger the nudge mechanism if the token count breaches the set threshold.

### 2.4 User Notification

- Display a simple notification using the existing system message mechanism when context reduction is suggested.
- The notification should inform the user that context reduction is being applied to optimize the conversation.

### 2.5 AI Decision Making

- Integrate the AI decision-making process for file removal into the existing ask-question flow.
- Focus on the relevance of files to the current conversation when deciding which files to remove from the context.

### 2.6 Automatic Application

- Apply the context reduction automatically once suggested, without requiring user confirmation.

### 2.7 Error Handling

- Implement error handling for situations where the AI fails to identify files for removal, even when the token count is high.
- This may include fallback strategies or additional prompts to the AI to reconsider its decision.

## 3. Considerations and Challenges

### 3.1 Performance Impact

- Consider the potential performance impact of adding token counting and context reduction logic to each exchange.
- Explore optimization techniques to minimize any negative impact on the overall performance of the step-ask-question flow.

### 3.2 Testing Strategy

- Develop a comprehensive testing strategy to ensure the token-aware mechanism works correctly.
- Create specific test cases for different scenarios, such as:
  - Token count just below the threshold
  - Token count just above the threshold
  - Token count significantly above the threshold

### 3.3 Logging and Monitoring

- Implement additional logging to track when context reductions occur.
- Monitor the effectiveness of reductions in terms of token count decrease.

### 3.4 Gradual Reduction

- Consider implementing a gradual reduction approach where files are removed in batches until the token count is below the threshold.
- This may provide a more balanced approach to context reduction.

### 3.5 Context Preservation

- Develop a mechanism to ensure that critical context is not lost during the automatic reduction process.
- Consider implementing a way to "protect" certain files from being removed, based on their importance to the conversation.

### 3.6 User Feedback

- Although the process will be automatic, consider providing a way for users to give feedback on the effectiveness of the context reduction.
- This feedback could be used to improve the AI's decision-making process over time.

### 3.7 Extensibility

- Design the feature to be easily configurable and extensible in the future.
- Consider allowing for different reduction strategies or adjustable thresholds in future iterations.

### 3.8 Integration with Existing Codebase

- Ensure smooth integration with the existing step-ask-question flow in `src/prompt/steps/step-ask-question.ts`.
- Minimize disruption to other parts of the codebase.

### 3.9 Documentation

- Provide clear documentation on how the context shrinking feature works.
- Include guidelines for developers on how to work with and potentially extend the feature in the future.

This implementation plan serves as a roadmap for developing the context shrinking feature. It outlines the key components of the feature and highlights important considerations and potential challenges that may arise during development. As the implementation progresses, this document can be updated to reflect any changes or additional insights gained during the development process.
