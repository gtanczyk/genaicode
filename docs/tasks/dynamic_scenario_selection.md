# Dynamic Scenario Selection

## Overview

This document outlines the specification for implementing dynamic scenario selection in GenAIcode. Instead of relying on a command-line parameter, the system should allow the LLM to dynamically determine the appropriate task scenario during the conversation with the user. This approach will enable a more flexible, context-aware, and user-friendly code generation process.

## Goals

- **Remove the CLI Parameter**: Eliminate the `--scenario` parameter from the CLI options.
- **Dynamic Scenario Inference**: Enable the LLM to infer the task scenario (bugfix, feature, refactoring, documentation) from the user's prompt and ongoing conversation.
- **Contextual Adaptation**: Allow the AI to adapt its behavior based on the inferred scenario, providing specific guidance and instructions.
- **Improved User Experience**: Create a more seamless and natural interaction with the tool, removing the need for manual scenario specification.

## Implementation Details

1.  **System Prompt Update**: Modify the system prompt to instruct the LLM on how to infer the task scenario from the user's input. The prompt should:

    - Explain the available scenarios (bugfix, feature, refactoring, documentation).
    - Instruct the LLM to analyze the user's prompt and conversation history to determine the most appropriate scenario.
    - Guide the LLM to use its understanding of the task to apply specific instructions and guidelines related to the inferred scenario.

2.  **CLI Parameter Removal**: Remove the `--scenario` parameter from `cli-params.ts` and `validate-cli-params.ts`.

3.  **Test Updates**: Update the test suite to reflect the removal of the CLI parameter. Test the dynamic scenario selection in combination with other parameters.

4.  **Code Generation**: Ensure that the dynamic scenario selection works seamlessly with the existing code generation process.

5.  **Documentation**: Update relevant documentation to reflect the changes in the tool’s behavior and options.

## Considerations

- **Token Usage**: Ensure that the new system prompt does not exceed token limits.
- **Error Handling**: Implement proper error handling in case the LLM fails to infer a scenario.
- **User Feedback**: Allow the user to correct or override the inferred scenario if necessary. This could be implemented via `iterate` action type.

## Example Scenarios\*\*

- **User Prompt**: "Fix the bug where the login button doesn't work."
  - **Inferred Scenario**: bugfix
- **User Prompt**: "Add a new user profile page."
  - **Inferred Scenario**: feature
- **User Prompt**: "Improve the code structure in the authentication module."
  - **Inferred Scenario**: refactoring
- **User Prompt**: "Write documentation for the new API endpoints."
  - **Inferred Scenario**: documentation

## Next Steps

1. Implement the system prompt updates to enable the LLM to infer task scenario.
2. Remove the CLI parameter and its validation.
3. Implement the dynamic scenario selection logic using the iterate action type if necessary.
4. Test the changes thoroughly to ensure that it works seamlessly with other parameters.
5. Update documentation to reflect the new changes.

This specification will guide the implementation of dynamic scenario selection, allowing GenAIcode to become more adaptable and user-friendly. This approach will be more user-friendly and will more closely align with the conversational nature of the tool. It will also allow the AI to better understand the user's intent and provide more relevant assistance.
