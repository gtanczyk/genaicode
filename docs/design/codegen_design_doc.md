# Design Document for Codegen Tool

## Overview

The Codegen tool is designed to automate code generation tasks using Vertex AI, OpenAI models, and Anthropic's Claude model. This tool is intended to enhance developer productivity by assisting with the generation of repetitive or complex code.

## How It Works

1. **Reading Source Code**: The Codegen tool reads the entire source code of the application.
2. **Identifying Codegen Fragments**: It identifies fragments marked with `@CODEGEN` comments which indicate sections where code generation is required.
3. **Generating Code**: Depending on the configuration, the tool sends these fragments to either Vertex AI, OpenAI's chat model, or Anthropic's Claude model to generate the required code.
4. **Updating Source Code**: The tool replaces the identified fragments with the generated code and updates the source code files.

## Components

### CLI Parameters

The tool accepts several CLI parameters to control its behavior:

- `--dry-run`: Runs the tool without making any changes to the files.
- `--consider-all-files`: Considers all files for code generation, even if they don't contain `@CODEGEN` comments.
- `--allow-file-create`: Allows the tool to create new files.
- `--allow-file-delete`: Allows the tool to delete files.
- `--allow-directory-create`: Allows the tool to create directories.
- `--allow-file-move`: Allows the tool to move files within the project structure.
- `--codegen-only`: Limits the scope of code generation to the `codegen` directory.
- `--game-only`: Limits the scope of code generation to the `src` directory.
- `--chat-gpt`: Uses the OpenAI model for code generation instead of Vertex AI.
- `--anthropic`: Uses Anthropic's Claude model for code generation.
- `--explicit-prompt`: Provides an explicit prompt for code generation.
- `--task-file`: Specifies a file with a task description for code generation.
- `--dependency-tree`: Limits the scope of code generation to files marked with `@CODEGEN` and their dependencies.
- `--verbose-prompt`: Prints the prompt used for code generation.

### Main Execution Flow

1. **Initialization**: The tool initializes by parsing the CLI parameters and reading the source code files.
2. **Prompt Construction**: Based on the CLI parameters and identified `@CODEGEN` fragments, the tool constructs the system and code generation prompts.
3. **Code Generation**: It sends the prompts to the specified AI model (Vertex AI, OpenAI, or Anthropic) and receives the generated code.
4. **File Updates**: The tool updates the files with the generated code. If in dry-run mode, it only prints the changes without applying them.
5. **Feedback and Cost Estimation**: The tool provides feedback on the token usage and estimated cost for the code generation process.

## AI Models

### Vertex AI (Default)

The tool uses Google's Vertex AI with the Gemini Pro model by default. It provides high-quality code generation and is optimized for various programming tasks.

### OpenAI GPT

When the `--chat-gpt` flag is used, the tool switches to OpenAI's GPT model. This model is known for its versatility and strong performance across various coding tasks.

### Anthropic Claude

The `--anthropic` flag enables the use of Anthropic's Claude model. Claude is designed to be helpful, harmless, and honest, making it suitable for code generation tasks that require a high degree of reliability and safety.

## File Operations

The Codegen tool now supports the following file operations:

- Creating new files
- Deleting existing files
- Creating new directories
- Moving files within the project structure
- Updating existing files

These operations are controlled by their respective CLI parameters and are executed based on the AI model's suggestions.

## Conclusion

The Codegen tool is a versatile and powerful assistant for developers, capable of leveraging multiple AI models to generate code efficiently. By supporting various configuration options and AI models, it provides flexibility to suit different project needs and developer preferences. The addition of the file move functionality further enhances its capabilities in managing project structure.