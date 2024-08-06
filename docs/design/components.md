# Components of GenAIcode Tool

The GenAIcode tool consists of several key components that work together to provide a comprehensive code generation solution. This document outlines these components and their functionalities.

## CLI Parameters

The tool accepts various command-line interface (CLI) parameters to control its behavior:

- `--dry-run`: Runs the tool without making any changes to the files.
- `--consider-all-files`: Considers all files for code generation, even if they don't contain `@CODEGEN` comments.
- `--allow-file-create`: Allows the tool to create new files.
- `--allow-file-delete`: Allows the tool to delete files.
- `--allow-directory-create`: Allows the tool to create directories.
- `--allow-file-move`: Allows the tool to move files within the project structure.
- `--chat-gpt`: Uses the OpenAI model for code generation.
- `--anthropic`: Uses Anthropic's Claude model for code generation.
- `--vertex-ai`: Uses Vertex AI with Google's Gemini Pro model for code generation.
- `--vertex-ai-claude`: Uses Claude via Vertex AI for code generation.
- `--explicit-prompt`: Provides an explicit prompt for code generation.
- `--task-file`: Specifies a file with a task description for code generation.
- `--dependency-tree`: Limits the scope of code generation to files marked with `@CODEGEN` and their dependencies.
- `--verbose-prompt`: Prints the prompt used for code generation.
- `--require-explanations`: Requires explanations for all code generation operations.
- `--disable-context-optimization`: Disables the optimization that uses context paths for more efficient code generation.
- `--gemini-block-none`: Disables safety settings for Gemini Pro model (requires whitelisted Cloud project).
- `--disable-initial-lint`: Skips the initial lint check before running the code generation process.
- `--temperature`: Sets the temperature parameter for the AI model (default: 0.7).
- `--vision`: Enables vision capabilities for processing image inputs.

## Main Execution Flow

The main execution flow of the GenAIcode tool consists of the following steps:

1. **Initialization**:

   - Parse CLI parameters
   - Read source code files

2. **Initial Lint Check**:

   - Run lint command (if specified and not disabled)

3. **Prompt Construction**:

   - Construct system and code generation prompts based on CLI parameters and `@CODEGEN` fragments

4. **Code Generation**:

   - Send prompts to the specified AI model
   - Receive generated code

5. **File Updates**:

   - Update files with generated code
   - In dry-run mode, only print changes without applying them

6. **Post-Generation Lint**:

   - Run lint command to check generated code

7. **Lint Fix (if needed)**:

   - If post-generation lint fails, send lint errors back to AI model for correction
   - Apply suggested fixes
   - Re-run lint check

8. **Feedback and Cost Estimation**:
   - Provide feedback on token usage
   - Estimate cost for the code generation process

This execution flow ensures a systematic approach to code generation, incorporating quality checks and providing valuable feedback to the user throughout the process.
