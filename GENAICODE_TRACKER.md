# GenAIcode project tracker

This file is used by GenAIcode to keep track of done, in progress, and planned changes in the GenAIcode project.

## Issues

- [x] Update AI Studio Models Configuration
  - Added experimental Gemini models support
  - Configured gemini-exp-1206 as default model
  - Configured gemini-2.0-flash-exp as cheap model
  - Enhanced model selection flexibility
- [x] Implement code planning plugin hook
- [x] Add .genaicoderc configuration assistance
  - Added .genaicoderc explanation to system prompt
  - Made .genaicoderc always available in context
  - Enhanced ability to assist with configuration issues
- [x] Add JSON Schema Support for .genaicoderc
  - Created comprehensive JSON schema definition
  - Implemented virtual files mechanism
  - Made schema always available in context
  - Added schema documentation
  - Enhanced configuration validation support
- [x] Add unit test for content generation retry in handleAiServiceFallback
