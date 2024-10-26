<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="media/logo-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="media/logo.png">
    <img alt="GenAIcode Logo." src="media/logo.png" width="100%" height="auto">
  </picture>
</p>

<div align="center">

# Programming on steroids

  <a href="https://www.npmjs.com/package/genaicode">
    <img alt="npm version" src="https://img.shields.io/npm/v/genaicode.svg?style=flat-square"></a>
  <a href="https://www.npmjs.com/package/genaicode">
    <img alt="weekly downloads from npm" src="https://img.shields.io/npm/dw/genaicode.svg?style=flat-square"></a>
  <a href="https://github.com/gtanczyk/genaicode/actions?query=branch%3Amaster">
    <img alt="Github Actions Build Status" src="https://img.shields.io/github/actions/workflow/status/gtanczyk/genaicode/lint.yaml?label=Tests&style=flat-square"></a>

</div>

---

> [!WARNING]
> 🚧 GenAIcode is under development, use at own risk, feedback is welcomed! 🚧

---

The GenAIcode tool is designed to automate code generation tasks using various AI models. This tool enhances developer productivity by assisting with analysis, and modification of code, and image assets. Works on any code base, can modify multiple files. Can be used via web browser, as a interactive or non-interactive CLI command, as a node.js library, or as [vite plugin](./src/vite-genaicode/README.md).

## Quick Start

In your project root directory, run:

```bash
npx genaicode --ui
open http://localhost:1337
```

This will start the GenAIcode web server and open the browser with the UI.

## CLI Features

GenAIcode supports various command-line options to customize its behavior:

- `--ai-service=<ai service>`: Pick an ai service/model that will be used for code generation
- `--ui`: Run the tool as a web server, and use it via browser
- `--ui-port=<port>`: Specify the port for the web server when using --ui (default: 1337)
- `--interactive`: Run the tool in interactive mode
- `--dry-run`: Runs the tool without making any changes to the files.
- `--consider-all-files`: Considers all files for code generation, even if they don't contain `@CODEGEN` comments.
- `--disallow-file-create`: Disallows the tool to create new files (file creation is allowed by default).
- `--disallow-file-delete`: Disallows the tool to delete files (file deletion is allowed by default).
- `--disallow-directory-create`: Disallows the tool to create directories (directory creation is allowed by default).
- `--disallow-file-move`: Disallows the tool to move files within the project structure (file moving is allowed by default).
- `--explicit-prompt=<prompt>`: Provides an explicit prompt for code generation.
- `--task-file=<file>`: Specifies a file with a task description for code generation.
- `--dependency-tree`: Limits the scope of code generation to files marked with `@CODEGEN` and their dependencies.
- `--verbose-prompt`: Prints the prompt used for code generation.
- `--disable-explanations`: Disables explanations for code generation operations. By default, explanations are enabled, as it improves response quality.
- `--disable-context-optimization`: Disables the optimization that uses context paths for more efficient code generation.
- `--gemini-block-none`: Disables safety settings for Gemini Pro model (requires whitelisted Cloud project).
- `--disable-initial-lint`: Skips the initial lint check before running the code generation process.
- `--temperature=<value>`: Sets the temperature parameter for the AI model (default: 0.7).
- `--vision`: Enables vision capabilities for processing image inputs.
- `--imagen`: Enables image generation capabilities using AI models.
- `--cheap`: Uses a cheaper, faster model for code generation, which may provide lower quality results but is more cost-effective for simpler tasks.
- `--content-mask=<path>`: Applies a content mask to limit the initial source code files included in the request. The value should be a prefix of the path relative to rootDir.
- `--ignore-pattern="glob/regex"`: Specify a pattern of files to ignore during the initial source code fetching. This saves initial token usage.
- `--disable-ask-question`: Disable the default behavior of AI assistant to ask questions for clarification during the code generation process.
- `--disable-cache`: Disables caching for the application, which can be useful if caching is causing issues or if you want to ensure fresh data is used for each operation.
- `--help`: Displays the help message with all available options.

## Configuration (.genaicoderc)

The `.genaicoderc` file allows you to configure various aspects of GenAIcode's behavior. Here are the available options:

```json
{
  "rootDir": ".",
  "extensions": [".md", ".js", ".ts", ".tsx", ".css"],
  "ignorePaths": ["node_modules", "build", "dist", "package-lock.json", "coverage"],
  "lintCommand": "npm run lint"
}
```

- `rootDir`: Specifies the root directory of your project (required).
- `extensions`: An array of file extensions to be considered by the tool (optional, defaults to a predefined list).
- `ignorePaths`: An array of paths to be ignored by the tool (optional).
- `lintCommand`: Specifies a lint command to be run before and after code generation (optional).
- `modelOverrides`: Allows overriding the default AI models used for each service (optional).

## Usage

To use GenAIcode, run the command with your desired options:

```bash
npx genaicode [options]
```

For example:

```bash
npx genaicode --explicit-prompt="Add a new utility function for string manipulation"
```

To run GenAIcode with the web UI on a specific port:

```bash
npx genaicode --ui --ui-port=8080
```

This will start the web server on port 8080 instead of the default 1337.

## Examples

For practical examples of using GenAIcode, visit our [Examples](examples/README.md) page.

## More Information

For in-depth details about GenAIcode's features, supported AI models, file operations, and advanced usage, please refer to our comprehensive [Design Document](docs/design/genaicode_design_doc.md).

## Feedback and Contributions

We welcome your feedback and contributions! Please feel free to open issues or submit pull requests on our GitHub repository.
