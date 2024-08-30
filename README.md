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

### 🚧 GenAIcode is under development, use at own risk, feedback is welcomed! 🚧

---

The GenAIcode tool is designed to automate code generation tasks using various AI models. This tool enhances developer productivity by assisting with the generation of repetitive or complex code.

## Quick Start

1. Create a `.genaicoderc` file in your project folder:

```
echo '{"rootDir": "."}' > .genaicoderc
```

2. Set up AI service credentials:

```bash
# For Vertex AI:
gcloud auth login
export GOOGLE_CLOUD_PROJECT="..."

# For Claude via Vertex AI:
gcloud auth login
export GOOGLE_CLOUD_PROJECT="..."
export GOOGLE_CLOUD_REGION="..."
```

3. Run GenAIcode:

```bash
npx genaicode --dry-run --explicit-prompt="Analyze my project sourcecode and write it to HELLO_GENAICODE.md" --consider-all-files
```

## CLI Features

GenAIcode supports various command-line options to customize its behavior:

- `--dry-run`: Runs the tool without making any changes to the files.
- `--consider-all-files`: Considers all files for code generation, even if they don't contain `@CODEGEN` comments.
- `--allow-file-create`: Allows the tool to create new files.
- `--allow-file-delete`: Allows the tool to delete files.
- `--allow-directory-create`: Allows the tool to create directories.
- `--allow-file-move`: Allows the tool to move files within the project structure.
- `--vertex-ai`: Uses Vertex AI with Google's Gemini Pro model for code generation.
- `--vertex-ai-claude`: Uses Claude via Vertex AI for code generation.
- `--ai-studio`: Uses Google AI Studio for code generation, an alternative to Vertex AI with potentially different capabilities or limitations.
- `--explicit-prompt=<prompt>`: Provides an explicit prompt for code generation.
- `--task-file=<file>`: Specifies a file with a task description for code generation.
- `--dependency-tree`: Limits the scope of code generation to files marked with `@CODEGEN` and their dependencies.
- `--verbose-prompt`: Prints the prompt used for code generation.
- `--require-explanations`: Requires explanations for all code generation operations.
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

## Usage

To use GenAIcode, run the command with your desired options:

```bash
npx genaicode [options]
```

For example:

```bash
npx genaicode --allow-file-create --explicit-prompt="Add a new utility function for string manipulation"
```

## Examples

For practical examples of using GenAIcode, visit our [Examples](examples/README.md) page.

## Demo

Here's a quick demo of GenAIcode in action:

![demo](media/demo-for-readme.gif 'demo')

## More Information

For in-depth details about GenAIcode's features, supported AI models, file operations, and advanced usage, please refer to our comprehensive [Design Document](docs/design/genaicode_design_doc.md).

## Feedback and Contributions

We welcome your feedback and contributions! Please feel free to open issues or submit pull requests on our GitHub repository.
