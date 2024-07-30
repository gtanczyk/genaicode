# GenAIcode

  <a href="https://www.npmjs.com/package/genaicode">
    <img alt="npm version" src="https://img.shields.io/npm/v/genaicode.svg?style=flat-square"></a>
  <a href="https://www.npmjs.com/package/genaicode">
    <img alt="weekly downloads from npm" src="https://img.shields.io/npm/dw/genaicode.svg?style=flat-square"></a>
  <a href="https://github.com/gtanczyk/genaicode/actions?query=branch%3Amaster">
    <img alt="Github Actions Build Status" src="https://img.shields.io/github/actions/workflow/status/gtanczyk/genaicode/lint.yaml?label=Tests&style=flat-square"></a>

---

### 🚧 GenAIcode is under development, use at own risk, feedback is welcomed! 🚧

---

The GenAIcode tool is designed to automate code generation tasks using Vertex AI, OpenAI models, and Anthropic's Claude model. This tool is intended to enhance developer productivity by assisting with the generation of repetitive or complex code.

## Installation

Create a `.genaicoderc` file in your project folder. The `rootDir` property indicates what should be the scope of working directory for `genaicode`. The tool will not go beyond that scope for neither analysis of source code, or suggesting changes.

```
echo '{"rootDir": "."}' > .genaicoderc
```

## Usage

```
# For Vertex AI user:
gcloud auth login
export GOOGLE_CLOUD_PROJECT="..."

# ChatGPT user:
export OPENAI_API_KEY="sk-..."

# Claude user
export ANTHROPIC_API_KEY="..."

npx genaicode --dry-run --explicit-prompt="Analyze my project sourcecode and write it to HELLO_GENAICODE.md" --consider-all-files
```

## Demo

This is an example of `npx genaicode` execution. The prompt was to refactor the code, and remove some duplication.

![demo](media/demo-for-readme.gif 'demo')

## Configuration

The `.genaicoderc` file supports the following options:

- `rootDir`: Specifies the root directory for the project (required).
- `extensions`: An array of file extensions to be considered by GenAIcode (optional).
- `ignorePaths`: An array of directory or file paths that should be ignored during the code analysis and generation process. Useful for excluding `node_modules` or build directories.

Example configuration:

```json
{
  "rootDir": ".",
  "extensions": [".md", ".js", ".ts", ".tsx", ".css"],
  "ignorePaths": ["node_modules", "build"]
}
```

If the `extensions` option is not specified, GenAIcode will use a default set of extensions: `.md`, `.js`, `.ts`, `.tsx`, `.css`, `.scss`, `.py`, `.go`, `.c`, `.h`, `.cpp`.

## Options

The codegen script accepts the following options:

- `--dry-run`: Run the codegen script without updating the source code.
- `--consider-all-files`: Consider all files for code generation, even if they don't contain the `@CODEGEN` comments.
- `--allow-file-create`: Allow the codegen script to create new files.
- `--allow-file-delete`: Allow the codegen script to delete files.
- `--allow-directory-create`: Allow codegen script to create directories
- `--disable-context-optimization`: Disable the optimization that uses context paths for more efficient code generation.
- `--allow-file-move`: Allow the codegen script to move files.
- `--chat-gpt`: Use the OpenAI model for code generation instead of Vertex AI with Google's Gemini Pro model.
- `--anthropic`: Use Anthropic's Claude model for code generation.
- `--vertex-ai`: Use Vertex AI with Google's Gemini Pro model for code generation (default if no AI model is specified).
- `--explicit-prompt`: An explicit prompt to use for code generation.
- `--task-file`: Specifies a file with a task description for code generation.
- `--dependency-tree`: Limit the scope of codegen only to files marked with `@CODEGEN` and their dependencies
- `--verbose-prompt`: Print the prompt used for code generation.
- `--require-explanations`: Require explanations for all code generation operations.
- `--gemini-block-none`: Disable safety settings for Gemini Pro model (requires whitelisted Cloud project).

Note: The `--chat-gpt`, `--anthropic`, and `--vertex-ai` flags are mutually exclusive. If none is specified, the default Vertex AI with Google's Gemini Pro model will be used.

## Supported AI Models

### Vertex AI (Default)

Uses Google's Vertex AI with the Gemini Pro model. This is the default option if no specific AI model flag is provided. Can be explicitly selected with the `--vertex-ai` flag.

### OpenAI GPT

Activated with the `--chat-gpt` flag. Uses OpenAI's GPT model for code generation.

When using Vertex AI with the Gemini Pro model, you can use the `--gemini-block-none` flag to disable safety settings. This option is only available for whitelisted Cloud projects and should be used with caution.

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

Note: The dependency tree feature currently only works for JavaScript/TypeScript codebases with ESM modules.

## Verbose Mode

The `--verbose-prompt` flag allows you to see the prompts being sent to the AI model. This can be useful for debugging or understanding how the tool constructs its requests.

## Requiring Explanations

The `--require-explanations` flag makes it mandatory for the AI model to provide explanations for all code generation operations. This can be useful for understanding the reasoning behind the changes, but may consume more tokens.
