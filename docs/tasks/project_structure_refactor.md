# Summary

Refactor of codegen project structure

# Description

## Old project structure

Current structure of the codegen tool is:

- /codegen directory:
  Responsible for:
  - README.md file
  - main entry point to the app: index.js file
  - cli parameter parsing and validation
  - reading source code directories
  - analyzing dependencies
  - generating system prompt
  - generating codegen prompt
  - dispatching prompt to appropriate AI service
  - handling response from AI service
  - updating files with new code, deleting, or creating new files
  - printing output to user
  - informing user about token usage

## New project structure

We want to have a new project structure:

- /codegen
  - README.md file
- /codegen/bin
  - a script to run the app
- /codegen/src/main
  - main entry point to the app: codegen.js (previously index.js file)
- /codegen/src/cli
  - cli parameter parsing and validatio
- /codegen/src/files
  - reading source code directories
  - analyzing dependencies
- /codegen/src/prompt
  - generating system prompt
  - generating codegen prompt
- /codegen/src/ai-servie
  - dispatching prompt to appropriate AI service
  - handling response from AI service
- /codegen/src/ai-service
  - updating files with new code, deleting, or creating new files
  - informing user about token usage

# Refactor plan

This is the suggested algorithm for refactor

1. Get a file from codegen/ directory (old project structure)
2. Find appropriate location in the new project structure
3. Create corresponding directory if it was not created already
4. Move the file to the new location (create a file with the same content, delete the old file)
