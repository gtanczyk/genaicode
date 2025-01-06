# GenAIcode project tracker

This file is used by GenAIcode to keep track of done, in progress, and planned changes in the GenAIcode project.

Issues are automatically tracked with unique identifiers (GEN-XXX) and dates. Each issue includes:

- A unique identifier (e.g., GEN-001)
- Status (done [x], in progress [-], planned [ ])
- Creation date
- Last update date
- Optional description and sub-items

## Issues

- [ ] [GEN-025] Implement Context Optimization Test for AI Module Selection
      Added a comprehensive test for context optimization in `/src/eval/context-optimization.test.ts` that: - Uses real AI Studio service - Verifies file selection for math module unit test - Demonstrates context optimization logic - Includes mock source code with diverse module summaries - Validates relevance-based file selection
      Created: 2024-01-06
      Updated: 2024-01-06

- [ ] [GEN-024] Add updateFile action type to askQuestion
      Added a new action type `updateFile` to the `askQuestion` function, allowing the assistant to make single file changes during the conversation without launching the full code generation step. The changes include updates to function definitions, action handlers, frontend components, and operations. The `updateFile` action type is integrated into the `getActionHandler` function, and the frontend components are updated to display the diff for the `updateFile` action and handle user confirmation. The `updateFile` operation is added to the operations index, and a function definition and executor are created for it. The `updateFile` function definition is also included in the list of available functions in `function-calling.ts`. Finally, the `GENAICODE_TRACKER.md` file is updated to reflect the new changes.
      Created: 2024-01-06
      Updated: 2024-01-06

- [ ] [GEN-021] Decompose backend/service.ts into smaller files

- [x] [GEN-020] Refactor CodegenSummaryView to combine update details into one row
      Refactored the CodegenSummaryView component to present update type, file path, temperature, and cheap/non-cheap in one row, with temperature and cheap/non-cheap styled as badges similar to UpdateType.
      Created: 2024-12-29
      Updated: 2024-12-29

# ... (rest of the existing content remains unchanged)
