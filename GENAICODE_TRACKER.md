# GenAIcode project tracker

This file is used by GenAIcode to keep track of done, in progress, and planned changes in the GenAIcode project.

Issues are automatically tracked with unique identifiers (GEN-XXX) and dates. Each issue includes:

- A unique identifier (e.g., GEN-001)
- Status (done [x], in progress [-], planned [ ])
- Creation date
- Last update date

## Issues

- [x] [GEN-080] 2024-08-05: Enhanced UI - Replaced 'Upload Images' text with icon in button components
- [-] [GEN-079] 2024-08-04: Implement image pasting in Question Handler
- [ ] [GEN-078] 2024-08-04: Implement image upload for question answers
- [-] [GEN-077] 2024-08-03: Fixed type error and polling issue in ChatStateContext
- [-] [GEN-076] 2024-08-03: Refactored AppState - Migrated state management logic to ChatStateContext to centralize state and remove prop drilling.
- [-] [GEN-075] 2024-08-03: Refactored Suggestion Generation - Implemented React Context to manage chat state and suggestions, removing prop drilling
- [-] [GEN-074] 2024-08-02: Enhanced Suggestion Generation - Suggestions now utilize more conversational context for improved relevance instead of only the last message
- [x] [GEN-073] 2024-08-01: Fixed suggestion generation hook in ChatInterface.tsx - Optimized dependency array to prevent continuous execution by depending on specific message properties instead of the entire messages array
- [-] [GEN-072] 2024-07-29 (Updated 2024-07-30): Implement suggestion chips using browser-side AI (Moved chips to QuestionHandler to fix bug)
- [-] [GEN-071] 2024-07-20: Local LLM AI Service Integration - Added Local LLM as a new AI service with OpenAI-compatible API support, custom base URL configuration, and model overrides for different model types.
- [x] [GEN-070] 2024-02-21: Enhanced Diff View - Extracted CopyToClipboard component with individual state management. Improved UI with icon button in top-right corner. Fixed shared state issue in side-by-side view. Includes success/failure states, styled consistently with existing UI.
- [-] [GEN-069] 2024-02-17: Enhanced Conversation Graph Edge Evaluation - Implemented LLM-based edge evaluation with condition handling, user input consideration, and traversal control.
- [-] [GEN-068] 2024-02-14: Conversation Graph Implementation - Added conversation graph functionality with directed graph traversal, node action execution, and edge condition handling. Includes cycle detection and error handling.
- [x] [GEN-067] 2024-02-13: Enhanced Multi-File Fragment Extraction - Improved fragment extraction to handle multiple files in a single LLM call, added file path tracking, and enhanced type safety
- [x] [GEN-066] 2024-02-12: Refactored File Request Handlers - extracted common functions into file-request-utils.ts to reduce code duplication and improve maintainability
- [x] [GEN-065] 2024-02-09: Request Files Fragments - Enhanced implementation with structured fragment extraction, improved documentation, and better type safety
- [x] [GEN-063] 2024-02-09: Token Usage Optimization - Replace MD5 with numeric file IDs
- [-] [GEN-064] 2024-02-09: Context Size Display - add token count next to timestamp in assistant messages
- [-] [GEN-062] 2024-02-09: Context Size Display - iteration header shows token count
- [x] [GEN-061] 2024-02-05: Enhanced Context Compression - autonomous compression, user confirmation
- [-] [GEN-060] 2024-02-04: Enhanced Context Compression - file dependencies, token management
- [-] [GEN-058] 2024-02-01: Context Compression Feature - conversation context compression
- [-] [GEN-059] 2024-02-03: Improved Context Compression - conversation history analysis
- [x] [GEN-055] 2024-01-28: Enhanced CLI Parameter Handling - positional arguments
- [x] [GEN-054] 2024-01-28: Enhanced Model Type Selection - model type dropdown
- [-] [GEN-050] 2024-01-23: Enhanced Diff View - patch operations UI
- [-] [GEN-049] 2024-01-22: AI Service Selection - dialog system enhancement
- [x] [GEN-048] 2024-01-21: Enhanced Cross-Context Notifications
- [x] [GEN-047] 2024-01-20: Enhanced Notifications System
- [-] [GEN-045] 2024-01-19: Reasoning Model Support - model type system
- [ ] [GEN-044] 2024-01-18: Enhanced AI Service Selector - model info display
- [ ] [GEN-043] 2024-01-17: Enhanced File Operation Handlers - content generation confirmation
- [ ] [GEN-041] 2024-01-16: Help System Implementation - in-context documentation
- [x] [GEN-040] 2024-01-15: Context Management Implementation - content-bus system
- [ ] [GEN-039] 2024-01-14: App Context Integration - context management in conversations
- [ ] [GEN-035] 2024-01-13: Contributing Guidelines - development setup, code style
- [x] [GEN-034] 2024-01-12: Add patchFile and updateFile test cases
- [x] [GEN-032] 2024-01-11: Add performAnalysis Action Type - complex tasks
- [x] [GEN-031] 2024-01-10: Add Retry Mechanism - AI service failures
- [ ] [GEN-030] 2024-01-09: Enhanced Long Explanation Test
- [ ] [GEN-028] 2024-01-08: Create code-generation test suite
- [ ] [GEN-027] 2024-01-07: Implement Ask Question Test Suite
- [ ] [GEN-026] 2024-01-06: Generate large mock-source-code-summaries dataset
- [ ] [GEN-025] 2024-01-05: Implement Context Optimization Test
- [ ] [GEN-024] 2024-01-04: Add updateFile action type
- [ ] [GEN-021] 2024-01-03: Decompose backend/service.ts
- [x] [GEN-020] 2024-01-02: Refactor CodegenSummaryView - update details
- [x] [GEN-019] 2024-01-01: Enhanced FileUpdateView - explanation toggle
- [x] [GEN-018] 2023-12-31: Refactor utility-endpoint.ts
- [x] [GEN-017] 2023-12-30: Decompose remaining endpoints in api.ts
- [ ] [GEN-015] 2023-12-29: Prompt suggestions feature
- [ ] [GEN-016] 2023-12-28: Input-area autocomplete feature
- [x] [GEN-014] 2023-12-27: Add old content handling to file updates
- [x] [GEN-013] 2023-12-26: Add FileUpdateView component
- [x] [GEN-012] 2023-12-25: Convert codegen-options-form to Config modal
- [x] [GEN-011] 2023-12-24: Plugins in Vite Genaicode - registration
- [x] [GEN-010] 2023-12-23: GenAIcode Tracker Enhancement - keys and dates
- [x] [GEN-001] 2023-12-22: File Updates Processing Enhancement
- [x] [GEN-002] 2023-12-21: Update AI Studio Models Configuration
- [x] [GEN-003] 2023-12-20: Implement code planning plugin hook
- [x] [GEN-004] 2023-12-19: Add .genaicoderc configuration assistance
- [x] [GEN-005] 2023-12-18: Add JSON Schema Support for .genaicoderc
- [x] [GEN-006] 2023-12-17: Add unit test for content generation retry
- [x] [GEN-007] 2023-12-16: Enhanced UI for Codegen Data Display
- [x] [GEN-008] 2023-12-15: System Message Container Enhancement
- [x] [GEN-009] 2023-12-14: UI Component Theme Dependency Cleanup
