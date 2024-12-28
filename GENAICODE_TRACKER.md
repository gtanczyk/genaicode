# GenAIcode project tracker

This file is used by GenAIcode to keep track of done, in progress, and planned changes in the GenAIcode project.

Issues are automatically tracked with unique identifiers (GEN-XXX) and dates. Each issue includes:

- A unique identifier (e.g., GEN-001)
- Status (done [x], in progress [-], planned [ ])
- Creation date
- Last update date
- Optional description and sub-items

## Issues

- [ ] [GEN-015] Prompt suggestions feature
      Add a feature to suggest prompts to users based on their input and context.
      Created: 2024-12-28

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
