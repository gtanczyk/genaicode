# codegen

This module is responsible for generating code using Vertex AI, Google's Gemini Pro model, OpenAI's GPT model, or Anthropic's Claude model.
It is used to automate some of the development process.

The main goal of this module is to help with generating repetitive code or code that is hard to write manually.
It is not meant to replace developers, but to help them be more productive.

## Usage

To use the codegen module, simply run the following command:

```
node codegen/index.js
```

This will run the codegen script, which will:

1. Read the source code of the application.
2. Find the fragments marked with `@CODEGEN`
3. Send the fragments to the selected AI model for code generation, depending on the flags used.
4. Replace the fragments with the generated code.
5. Save the updated source code.

## Options

The codegen script accepts the following options:

- `--dry-run`: Run the codegen script without updating the source code.
- `--consider-all-files`: Consider all files for code generation, even if they don't contain the `@CODEGEN` comments.
- `--allow-file-create`: Allow the codegen script to create new files.
- `--allow-file-delete`: Allow the codegen script to delete files.
- `--allow-directory-create`: Allow codegen script to create directories
- `--allow-file-move`: Allow the codegen script to move files.
- `--chat-gpt`: Use the OpenAI model for code generation instead of Vertex AI with Google's Gemini Pro model.
- `--anthropic`: Use Anthropic's Claude model for code generation.
- `--explicit-prompt`: An explicit prompt to use for code generation.
- `--task-file`: Specifies a file with a task description for code generation.
- `--dependency-tree`: Limit the scope of codegen only to files marked with `@CODEGEN` and their dependencies
- `--verbose-prompt`: Print the prompt used for code generation.
- `--require-explanations`: Require explanations for all code generation operations.

Note: The `--chat-gpt` and `--anthropic` flags are mutually exclusive. If neither is specified, the default Vertex AI with Google's Gemini Pro model will be used.

## Supported AI Models

### Vertex AI (Default)

Uses Google's Vertex AI with the Gemini Pro model. This is the default option if no specific AI model flag is provided.

### OpenAI GPT

Activated with the `--chat-gpt` flag. Uses OpenAI's GPT model for code generation.

### Anthropic Claude

Activated with the `--anthropic` flag. Uses Anthropic's Claude model for code generation.

### Vertex AI Monkey Patch

The Codegen tool includes a monkey patch for the Vertex AI library to enable the use of the `tool_config` parameter. This patch is necessary because the official Vertex AI Node.js client library does not yet support the `tool_config` parameter, which is required for function calling.

The patch is applied at runtime and modifies the `generateContent` function of the Vertex AI library to include the `tool_config` parameter in the request. This allows the Codegen tool to use function calling with Vertex AI, similar to how it works with other AI models.

## File Operations

The codegen tool can perform various file operations based on the provided flags:

- Create new files (with `--allow-file-create`)
- Delete existing files (with `--allow-file-delete`)
- Create new directories (with `--allow-directory-create`)
- Move files (with `--allow-file-move`)
- Update existing files (always allowed)

## Dependency Tree

When using the `--dependency-tree` flag, the tool will analyze the dependencies of files marked with `@CODEGEN` and include them in the code generation process. This ensures that all relevant files are considered, even if they're not directly marked for code generation.

## Verbose Mode

The `--verbose-prompt` flag allows you to see the prompts being sent to the AI model. This can be useful for debugging or understanding how the tool constructs its requests.

## Requiring Explanations

The `--require-explanations` flag makes it mandatory for the AI model to provide explanations for all code generation operations. This can be useful for understanding the reasoning behind the changes, but may consume more tokens.
