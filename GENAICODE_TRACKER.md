# GenAIcode project tracker

This file is used by GenAIcode to keep track of done, in progress, and planned changes in the GenAIcode project.

Issues are automatically tracked with unique identifiers (GEN-XXX) and dates. Each issue includes:

- A unique identifier (e.g., GEN-001)
- Status (done [x], in progress [-], planned [ ])
- Creation date
- Last update date
- Optional description and sub-items

## Issues

- [ ] [GEN-028] Create code-generation.test.ts test suite
      Added a new test suite `code-generation.test.ts` in the `/src/eval/` directory to evaluate the `updateFile` function and how models generate file updates. The test suite includes test cases for different AI models (Gemini Flash, Claude Haikku, GPT-4 Mini) and verifies that the `updateFile` function is called correctly and the file content is updated as expected.
      Created: 2024-01-09
      Updated: 2024-01-09

- [ ] [GEN-027] Implement Ask Question Test Suite
      Added ask-question.test.ts in the /src/eval/ directory to test the ask-question functionality. Initial implementation includes two test cases: - Test handling of 'hello' prompt with sendMessage action type - Test handling of 'good bye' prompt with cancelCodeGeneration action type
      The test suite follows the structure of context-optimization.test.ts and includes tests across multiple AI models (Gemini Flash, Claude Haikku, GPT-4 Mini).
      Created: 2024-01-06
      Updated: 2024-01-06

- [ ] [GEN-026] Generate large variant of mock-source-code-summaries.ts dataset
      Created a new file named `mock-source-code-summaries-large.ts` in the `/Users/gtanczyk/src/codegen/src/eval/data/` directory. This file contains a large dataset of mock source code summaries representing a complex todo app, including components such as user authentication, task management, project organization, settings, and other related functionalities. Each entry in the dataset includes the file path, a brief description of the file's purpose, and a list of its dependencies.
      Created: 2024-01-06
      Updated: 2024-01-06

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

- [x] [GEN-019] Enhanced FileUpdateView with explanation toggle and advanced diff view
      Added explanation toggle and advanced diff view with multiple modes (unified, side by side, old content, new content).
      Created: 2024-12-28
      Updated: 2024-12-28

- [x] [GEN-018] Refactor utility-endpoint.ts into separate files
      Split utility-endpoint.ts into question-endpoint.ts, usage-endpoint.ts, config-endpoint.ts, and iteration-endpoint.ts.
      Created: 2024-12-28
      Updated: 2024-12-28

- [x] [GEN-017] Decompose remaining endpoints in api.ts
      Decompose the remaining endpoints from api.ts into separate files in the backend/endpoints directory.
      Created: 2024-12-28

      - [x] [GEN-017.1] Create new endpoint files for remaining endpoints
      - [x] [GEN-017.2] Move endpoint logic from api.ts to new files
      - [x] [GEN-017.3] Update api.ts to register the new endpoints

- [ ] [GEN-015] Prompt suggestions feature
      Add a feature to suggest prompts to users based on their input and context.
      Created: 2024-12-28

      - [ ] [GEN-015.1] UI Frontend: Add chips component for prompt suggestions
      - [ ] [GEN-015.2] UI Backend: Implement backend logic for generating prompt suggestions

- [ ] [GEN-016] Input-area autocomplete feature
      Implement autocomplete functionality in the input-area component to enhance user interaction.
      Created: 2024-12-28

- [x] [GEN-014] Add old content handling to file updates
      Added functionality to read and store old content in file updates using getSourceCode. The old content is stored in fileUpdateResult.args.oldContent in plain text format.

  - Modified processFileUpdate function in step-process-file-updates.ts
  - Added error handling for file content reading
    Created: 2024-12-28
    Updated: 2024-12-28

- [x] [GEN-013] Add FileUpdateView component
      Added a new component to display file updates with collapsible diffs, file path, prompt, and explanation. The diff is hidden by default and expandable on click, with syntax highlighting and support for both light and dark themes.

  - Created new component file-update-view.tsx
  - Added styles in file-update-view-styles.ts
  - Integrated component into SystemMessageContainer
    Created: 2024-12-28
    Updated: 2024-12-28

- [x] [GEN-012] Convert codegen-options-form to Genaicode Config modal
      Converted the codegen-options-form into a modal component, following the same pattern as the Service Configuration modal.

  - Created new modal component genaicode-config-modal.tsx
  - Added styles in genaicode-config-modal-styles.ts
  - Added menu item in hamburger-menu.tsx
  - Updated app-layout.tsx to include the new modal
  - Removed old codegen-options-form.tsx
  - Updated app-handlers.tsx to handle modal functionality
  - Included modal in genaicode-app.tsx
    Created: 2024-12-28
    Updated: 2024-12-28

- [x] [GEN-011] Plugins in Vite Genaicode
      Enhanced plugin system with improved registration and validation.

  - Implemented idempotent plugin registration
  - Centralized plugin loading mechanism
  - Added robust plugin validation
  - Enhanced error handling and logging
  - Added plugin registry tracking
  - Integrated with Vite GenAIcode
  - Maintained backward compatibility
  - Added proper type safety
    Created: 2024-12-26
    Updated: 2024-12-26

- [x] [GEN-010] GenAIcode Tracker Enhancement
      Added issue tracking improvements with keys and dates

  - Added unique identifiers (GEN-XXX format) for each issue
  - Added creation and update date tracking
  - Enhanced tracker plugin functionality
  - Improved issue formatting and structure
  - Added automatic issue key generation
    Created: 2024-12-26
    Updated: 2024-12-26

- [x] [GEN-001] File Updates Processing Enhancement
      Enhanced file processing system with improved error handling and type safety

  - Completed refactoring of step-process-file-updates.ts
  - Added proper TypeScript types and interfaces
  - Improved error handling and recovery
  - Enhanced file update processing logic
  - Added detailed system messages
  - Improved code organization and maintainability
    Created: 2024-12-26
    Updated: 2024-12-26

- [x] [GEN-002] Update AI Studio Models Configuration
      Configured new Gemini models and enhanced model selection

  - Added experimental Gemini models support
  - Configured gemini-exp-1206 as default model
  - Configured gemini-2.0-flash-exp as cheap model
  - Enhanced model selection flexibility
    Created: 2024-12-26
    Updated: 2024-12-26

- [x] [GEN-003] Implement code planning plugin hook
      Created: 2024-12-26
      Updated: 2024-12-26

- [x] [GEN-004] Add .genaicoderc configuration assistance
      Enhanced configuration support and documentation

  - Added .genaicoderc explanation to system prompt
  - Made .genaicoderc always available in context
  - Enhanced ability to assist with configuration issues
    Created: 2024-12-26
    Updated: 2024-12-26

- [x] [GEN-005] Add JSON Schema Support for .genaicoderc
      Comprehensive JSON schema implementation

  - Created comprehensive JSON schema definition
  - Implemented virtual files mechanism
  - Made schema always available in context
  - Added schema documentation
  - Enhanced configuration validation support
    Created: 2024-12-26
    Updated: 2024-12-26

- [x] [GEN-006] Add unit test for content generation retry in handleAiServiceFallback
      Created: 2024-12-26
      Updated: 2024-12-26

- [x] [GEN-007] Enhanced UI for Codegen Data Display
      Comprehensive UI improvements for better data visualization

  - Added specialized components for planning and summary views
  - Implemented collapsible sections for better organization
  - Added syntax highlighting and improved readability
  - Created theme-aware styled components
  - Enhanced visual hierarchy and user experience
  - Added type safety and validation
  - Improved responsive design
    Created: 2024-12-26
    Updated: 2024-12-26

- [x] [GEN-008] System Message Container Enhancement
      Split view implementation and visual improvements

  - Implemented split view for codegen planning and summary
  - Added visual separation between system messages and codegen views
  - Enhanced styling and spacing for better readability
  - Maintained existing functionality for collapsing and data visibility
  - Added smooth transitions for visual changes
  - Improved TypeScript type safety
    Created: 2024-12-26
    Updated: 2024-12-26

- [x] [GEN-009] UI Component Theme Dependency Cleanup
      Theme system optimization and component enhancement

  - Removed direct theme dependencies from CodegenSummaryView
  - Aligned implementation with CodegenPlanningView
  - Enhanced themed styled components
  - Improved code consistency across components
  - Added type-safe update type variants
  - Maintained visual consistency while reducing coupling
    Created: 2024-12-26
    Updated: 2024-12-26
