# Design Document for GenAIcode Tool

## Overview

The GenAIcode tool is designed to automate code generation tasks using Vertex AI (with Google's Gemini Pro model), OpenAI's GPT model, Anthropic's Claude model, and Claude via Vertex AI. This tool enhances developer productivity by assisting with the generation of repetitive or complex code, and provides flexibility in choosing the AI service that best suits the project's needs.

## How It Works

1. **Reading Source Code**: The GenAIcode tool reads the entire source code of the application.
2. **Identifying GenAIcode Fragments**: It identifies fragments marked with `@CODEGEN` comments which indicate sections where code generation is required.
3. **Generating Code**: Depending on the configuration, the tool sends these fragments to either Vertex AI, OpenAI's chat model, Anthropic's Claude model, or Claude via Vertex AI to generate the required code.
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

### Main Execution Flow

1. **Initialization**: The tool initializes by parsing the CLI parameters and reading the source code files.
2. **Initial Lint Check**: If a lint command is specified in the configuration and `--disable-initial-lint` is not used, the tool runs the lint command to check for any existing issues.
3. **Prompt Construction**: Based on the CLI parameters and identified `@CODEGEN` fragments, the tool constructs the system and code generation prompts.
4. **Code Generation**: It sends the prompts to the specified AI model (Vertex AI, OpenAI, Anthropic, or Claude via Vertex AI) and receives the generated code.
5. **File Updates**: The tool updates the files with the generated code. If in dry-run mode, it only prints the changes without applying them.
6. **Post-Generation Lint**: If a lint command is specified, the tool runs it again to check the generated code.
7. **Lint Fix (if needed)**: If the post-generation lint fails, the tool attempts to fix the issues by sending the lint errors back to the AI model for correction.
8. **Feedback and Cost Estimation**: The tool provides feedback on the token usage and estimated cost for the code generation process.

## AI Models

### Vertex AI (Default)

The tool uses Google's Vertex AI with the Gemini Pro model by default. It provides high-quality code generation and is optimized for various programming tasks. The `--gemini-block-none` flag can be used to disable safety settings for whitelisted Cloud projects.

### OpenAI GPT

When the `--chat-gpt` flag is used, the tool switches to OpenAI's GPT model. This model is known for its versatility and strong performance across various coding tasks.

### Anthropic Claude

The `--anthropic` flag enables the use of Anthropic's Claude model. Claude is designed to be helpful, harmless, and honest, making it suitable for code generation tasks that require a high degree of reliability and safety.

### Claude via Vertex AI

The `--vertex-ai-claude` flag enables the use of Anthropic's Claude model through Vertex AI. This option combines the capabilities of Claude with the infrastructure of Vertex AI, providing an alternative way to access Claude's functionality. It requires setting both `GOOGLE_CLOUD_PROJECT` and `GOOGLE_CLOUD_REGION` environment variables.

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
- For Claude via Vertex AI: Input and output tokens are counted and priced based on Vertex AI pricing.

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

## Ignore Paths

The GenAIcode tool now supports an `ignorePaths` feature, allowing users to specify directories or files that should be excluded from the code analysis and generation process.

### Configuration

Users can specify paths to be ignored by adding an `ignorePaths` array to their `.genaicoderc` file:

```json
{
  "rootDir": ".",
  "extensions": [".md", ".js", ".ts", ".tsx", ".css"],
  "ignorePaths": ["node_modules", "build", "dist"]
}
```

### Usage

The `ignorePaths` feature affects the following aspects of the tool's functionality:

1. **File Discovery**: When scanning the project directory, any file or directory matching the specified ignore paths will be excluded from consideration.
2. **Code Generation**: The tool will not generate or modify code in files that match the ignore paths.
3. **Dependency Analysis**: When using the dependency tree feature, files in ignored paths will not be considered as dependencies.

### Benefits

- **Performance**: By excluding large directories like `node_modules`, the tool can run faster and consume less memory.
- **Focus**: Users can ensure that the tool only operates on relevant parts of their project, ignoring build artifacts or third-party code.
- **Customization**: Projects with specific directory structures or naming conventions can easily customize which paths should be included or excluded from the code generation process.

### Implementation

The `ignorePaths` feature is implemented in the `findFiles` function within the `find-files.js` module. When traversing the directory structure, the function checks each path against the `ignorePaths` array and skips any matching files or directories.

## Lint Command Integration

The GenAIcode tool now includes a lint command integration feature, allowing users to specify a lint command in their `.genaicoderc` file. This feature helps maintain code quality throughout the generation process.

### Configuration

Users can specify a lint command by adding a `lintCommand` property to their `.genaicoderc` file:

```json
{
  "rootDir": ".",
  "extensions": [".md", ".js", ".ts", ".tsx", ".css"],
  "lintCommand": "npm run lint"
}
```

### Usage

The lint command is used in two ways:

1. **Initial Lint Check**: Before code generation, the tool runs the specified lint command to check for any existing issues. This step can be skipped using the `--disable-initial-lint` flag.

2. **Post-Generation Lint**: After code generation, the tool runs the lint command again to check the generated code.

### Lint Fix Process

If the post-generation lint fails, the tool attempts to fix the issues by:

1. Capturing the lint error output.
2. Sending the error information back to the AI model.
3. Requesting code changes to fix the lint issues.
4. Applying the suggested fixes.
5. Running the lint command again to verify the fixes.

### Benefits

- **Code Quality**: Ensures that generated code adheres to project-specific coding standards.
- **Consistency**: Maintains consistency between existing code and newly generated code.
- **Automation**: Reduces manual intervention needed to fix linting issues in generated code.

### Implementation

The lint command integration is primarily implemented in the `runCodegen` function within the `codegen.js` module. It uses the `child_process.exec` function to run the lint command and process its output.

## Disabling Initial Lint

The `--disable-initial-lint` option allows users to skip the initial lint check before running the code generation process.

### Usage

Users can add this flag when running the GenAIcode tool:

```
npx genaicode --disable-initial-lint
```

### Behavior

When this flag is used:

1. The tool skips the initial lint check that would normally run before code generation.
2. Code generation proceeds immediately without considering pre-existing lint issues.
3. The post-generation lint check (if configured) still runs after code generation.

### Benefits

- **Faster Execution**: Useful when users are confident in their existing code's lint status or when they want to focus solely on code generation.
- **Flexibility**: Allows for code generation in projects that may temporarily not pass linting standards.

### Considerations

- Users should be aware that skipping the initial lint might result in generated code that doesn't immediately align with project linting standards.
- It's recommended to run a manual lint check after using this option to ensure overall code quality.

### Implementation

The `--disable-initial-lint` flag is processed in the CLI parameters parsing section and influences the execution flow in the `runCodegen` function within the `codegen.js` module.

## Conclusion

The GenAIcode tool is a versatile and powerful assistant for developers, capable of leveraging multiple AI models to generate code efficiently. By supporting various configuration options, AI models, configurable file extensions, and now the ability to ignore specific paths, it provides flexibility to suit different project needs and developer preferences. The tool's ability to handle various file operations, consider dependencies, optimize context, provide token usage feedback, and support custom configurations makes it a comprehensive solution for automated code generation and management.

The addition of the lint command integration and the option to disable initial lint checks further enhances the tool's capabilities, allowing for better code quality control and more flexible usage scenarios. These features demonstrate the tool's ongoing development to meet the diverse needs of developers and projects.
