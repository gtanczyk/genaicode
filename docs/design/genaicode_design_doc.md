# Design Document for GenAIcode Tool

## Overview

The GenAIcode tool is designed to automate code generation tasks using Vertex AI (with Google's Gemini Pro model), OpenAI's GPT model, and Anthropic's Claude model. This tool enhances developer productivity by assisting with the generation of repetitive or complex code, and provides flexibility in choosing the AI service that best suits the project's needs.

## How It Works

1. **Reading Source Code**: The GenAIcode tool reads the entire source code of the application.
2. **Identifying GenAIcode Fragments**: It identifies fragments marked with `@CODEGEN` comments which indicate sections where code generation is required.
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
- `--chat-gpt`: Uses the OpenAI model for code generation.
- `--anthropic`: Uses Anthropic's Claude model for code generation.
- `--vertex-ai`: Uses Vertex AI with Google's Gemini Pro model for code generation (default).
- `--explicit-prompt`: Provides an explicit prompt for code generation.
- `--task-file`: Specifies a file with a task description for code generation.
- `--dependency-tree`: Limits the scope of code generation to files marked with `@CODEGEN` and their dependencies.
- `--verbose-prompt`: Prints the prompt used for code generation.
- `--require-explanations`: Requires explanations for all code generation operations.
- `--disable-context-optimization`: Disables the optimization that uses context paths for more efficient code generation.
- `--gemini-block-none`: Disables safety settings for Gemini Pro model (requires whitelisted Cloud project).

### Main Execution Flow

1. **Initialization**: The tool initializes by parsing the CLI parameters and reading the source code files.
2. **Prompt Construction**: Based on the CLI parameters and identified `@CODEGEN` fragments, the tool constructs the system and code generation prompts.
3. **Code Generation**: It sends the prompts to the specified AI model (Vertex AI, OpenAI, or Anthropic) and receives the generated code.
4. **File Updates**: The tool updates the files with the generated code. If in dry-run mode, it only prints the changes without applying them.
5. **Feedback and Cost Estimation**: The tool provides feedback on the token usage and estimated cost for the code generation process.

## AI Models

### Vertex AI (Default)

The tool uses Google's Vertex AI with the Gemini Pro model by default. It provides high-quality code generation and is optimized for various programming tasks. The `--gemini-block-none` flag can be used to disable safety settings for whitelisted Cloud projects.

### OpenAI GPT

When the `--chat-gpt` flag is used, the tool switches to OpenAI's GPT model. This model is known for its versatility and strong performance across various coding tasks.

### Anthropic Claude

The `--anthropic` flag enables the use of Anthropic's Claude model. Claude is designed to be helpful, harmless, and honest, making it suitable for code generation tasks that require a high degree of reliability and safety.

## File Operations

The GenAIcode tool supports the following file operations:

- Creating new files (with `--allow-file-create`)
- Deleting existing files (with `--allow-file-delete`)
- Creating new directories (with `--allow-directory-create`)
- Moving files within the project structure (with `--allow-file-move`)
- Updating existing files (always allowed)

These operations are controlled by their respective CLI parameters and are executed based on the AI model's suggestions.

## Dependency Tree

When using the `--dependency-tree` flag, the tool analyzes the dependencies of files marked with `@CODEGEN` and includes them in the code generation process. This ensures that all relevant files are considered, even if they're not directly marked for code generation.

## Verbose Mode

The `--verbose-prompt` flag allows users to see the prompts being sent to the AI model. This can be useful for debugging or understanding how the tool constructs its requests.

## Requiring Explanations

The `--require-explanations` flag makes it mandatory for the AI model to provide explanations for all code generation operations. This can be useful for understanding the reasoning behind the changes but may consume more tokens.

## Context Optimization

The tool includes a context optimization feature that can be disabled with the `--disable-context-optimization` flag. This optimization uses context paths to provide more efficient and focused code generation.

## Vertex AI Monkey Patch

The GenAIcode tool includes a monkey patch for the Vertex AI library to enable the use of the `tool_config` parameter. This patch is necessary because the official Vertex AI Node.js client library does not yet support the `tool_config` parameter, which is required for function calling.

## Token Usage and Cost Estimation

The tool now provides feedback on token usage and estimated cost for each AI model:

- For Vertex AI: Input and output characters are counted and priced separately.
- For OpenAI GPT: Input and output tokens are counted and priced separately.
- For Anthropic Claude: Input and output tokens are counted and priced separately.

This information is displayed at the end of each code generation process, helping users understand the resource usage and associated costs.

## Configurable File Extensions

The GenAIcode tool now supports configurable file extensions through the `.genaicoderc` configuration file. This feature allows users to specify which file extensions should be considered by the tool during code generation and analysis.

### Configuration

Users can specify the file extensions to be considered by adding an `extensions` array to their `.genaicoderc` file:

```json
{
  "rootDir": ".",
  "extensions": [".md", ".js", ".ts", ".tsx", ".css"]
}
```

### Default Extensions

If no `extensions` array is specified in the `.genaicoderc` file, the tool uses a default set of extensions:

```json
[".md", ".js", ".ts", ".tsx", ".css", ".scss", ".py", ".go", ".c", ".h", ".cpp"]
```

### Usage

The configurable extensions feature affects various parts of the tool's functionality:

1. **File Discovery**: When scanning the project directory, only files with the specified extensions will be considered for code generation and analysis.
2. **Dependency Analysis**: The dependency tree feature will only consider files with the specified extensions when analyzing dependencies.

### Limitations

It's important to note that the dependency tree feature currently only works for JavaScript/TypeScript codebases with ESM modules. This limitation is independent of the configurable extensions feature.

## Conclusion

The GenAIcode tool is a versatile and powerful assistant for developers, capable of leveraging multiple AI models to generate code efficiently. By supporting various configuration options, AI models, and now configurable file extensions, it provides flexibility to suit different project needs and developer preferences. The tool's ability to handle various file operations, consider dependencies, optimize context, provide token usage feedback, and now support custom file extension configurations makes it a comprehensive solution for automated code generation and management.
