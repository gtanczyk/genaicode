export const GENAICODE_HELP_DOCUMENT = `# GenAIcode Help Documentation

## Overview

GenAIcode is an AI-powered code generation and management tool designed to streamline software development. It leverages various AI services (Vertex AI, AI Studio, OpenAI, Anthropic) to generate, modify, and analyze code. The tool supports interactive and UI modes, allowing developers to execute code generation tasks, manage prompts, and visualize outputs.

## Features

### Core Features

1. **Multiple AI Service Integration**
   - Vertex AI (with Gemini Pro support)
   - OpenAI (GPT-4 with function calling)
   - Anthropic (Claude 3 with tool use)
   - AI Studio (Gemini Pro)
   - AI Service Fallback handling
   - Plugin-based AI service extensibility

2. **Operation Modes**
   - Interactive CLI mode
   - Web UI mode
   - Task file execution
   - Batch processing

3. **Code Generation Capabilities**
   - Smart context management
   - File operations (create, update, delete, move)
   - Code analysis and optimization
   - Image generation and processing
   - Plugin system for custom operations

### Advanced Features

1. **Context Optimization**
   - Automatic context pruning
   - Smart file selection
   - Token usage optimization
   - History management

2. **Project Profiles**
   - Automatic project type detection
   - Framework-specific configurations
   - Custom profile support

3. **Plugin System**
   - Custom AI services
   - Operation extensions
   - Action handlers
   - Pre/post operation hooks

## CLI Options

### Basic Options
\`\`\`bash
genaicode [options] [prompt]
\`\`\`

- \`--interactive\`: Enable interactive mode
- \`--ui\`: Launch web UI interface
- \`--task-file <path>\`: Execute task from file
- \`--verbose-prompt\`: Enable detailed prompt logging

### Permission Options
- \`--allow-file-create\`: Allow file creation
- \`--allow-file-delete\`: Allow file deletion
- \`--allow-directory-create\`: Allow directory creation
- \`--allow-file-move\`: Allow file moving

### AI Service Options
- \`--ai-service <service>\`: Select AI service (vertex-ai|ai-studio|openai|anthropic)
- \`--vision\`: Enable image analysis capabilities
- \`--imagen <service>\`: Enable image generation (vertex-ai|dall-e)

### Optimization Options
- \`--temperature <value>\`: Set model temperature (0.0-2.0)
- \`--cheap\`: Use faster, cheaper model variants
- \`--content-mask <path>\`: Filter content by path
- \`--disable-context-optimization\`: Disable automatic context optimization

### Control Options
- \`--disable-ask-question\`: Disable interactive questioning
- \`--disable-explanations\`: Disable detailed explanations
- \`--disable-cache\`: Disable caching
- \`--disable-history\`: Disable conversation history
- \`--ui-port <port>\`: Set UI server port

## Configuration

### .genaicoderc File
\`\`\`json
{
  "rootDir": ".",
  "ignorePaths": [
    "node_modules",
    "dist",
    "coverage"
  ],
  "lintCommand": "npm run lint",
  "extensions": [".js", ".ts", ".jsx", ".tsx"],
  "importantContext": {
    "files": ["important-file.ts"],
    "systemPrompt": ["Custom system prompt"]
  },
  "plugins": ["./path/to/plugin.js"],
  "modelOverrides": {
    "aiStudio": {
      "default": "gemini-pro",
      "cheap": "gemini-2.0-flash"
    }
  }
}
\`\`\`

### Configuration Options

1. **Root Directory**
   - \`rootDir\`: Project root directory
   - Relative to .genaicoderc location

2. **File Management**
   - \`ignorePaths\`: Paths to exclude
   - \`extensions\`: File extensions to process
   - \`lintCommand\`: Custom lint command

3. **Context Management**
   - \`importantContext\`: Critical files and prompts
   - \`contentMask\`: Path-based content filtering

4. **AI Services**
   - \`modelOverrides\`: Service-specific model settings
   - \`plugins\`: Custom AI service plugins

## Troubleshooting

### Common Issues

1. **Permission Errors**
   \`\`\`
   Error: Operation not allowed
   \`\`\`
   Solution: Use appropriate permission flags (--allow-file-create, etc.)

2. **Context Size Limits**
   \`\`\`
   Error: Context size exceeded
   \`\`\`
   Solution: Enable context optimization or use content masks

3. **AI Service Errors**
   \`\`\`
   Error: Rate limit exceeded
   \`\`\`
   Solution: Switch to a different AI service or wait before retrying

4. **Plugin Loading Issues**
   \`\`\`
   Error: Failed to load plugin
   \`\`\`
   Solution: Check plugin path and compatibility

### Best Practices

1. **Context Optimization**
   - Use content masks for large projects
   - Enable context optimization
   - Keep important files in configuration

2. **Performance**
   - Use cheap mode for rapid iterations
   - Enable caching for repeated operations
   - Use appropriate temperature settings

3. **Code Generation**
   - Provide clear, specific prompts
   - Use task files for complex operations
   - Review changes before applying

## Examples

### Basic Usage

1. **Interactive Mode**
   \`\`\`bash
   genaicode --interactive
   \`\`\`

2. **Web UI**
   \`\`\`bash
   genaicode --ui --ui-port 3000
   \`\`\`

3. **Direct Prompt**
   \`\`\`bash
   genaicode "Create a new React component"
   \`\`\`

### Advanced Usage

1. **Task File Execution**
   \`\`\`bash
   genaicode --task-file tasks/new-feature.md
   \`\`\`

2. **Custom AI Service**
   \`\`\`bash
   genaicode --ai-service openai --temperature 0.7
   \`\`\`

3. **Image Generation**
   \`\`\`bash
   genaicode --imagen vertex-ai "Generate logo"
   \`\`\`

### Project Configuration

1. **Basic Configuration**
   \`\`\`json
   {
     "rootDir": ".",
     "ignorePaths": ["node_modules"],
     "lintCommand": "npm run lint"
   }
   \`\`\`

2. **Advanced Configuration**
   \`\`\`json
   {
     "rootDir": ".",
     "extensions": [".ts", ".tsx"],
     "importantContext": {
       "files": ["src/main.ts"]
     },
     "plugins": ["./plugins/custom.js"]
   }
   \`\`\`

## Additional Resources

1. **Documentation**
   - [GitHub Repository](https://github.com/your-repo/genaicode)
   - [API Documentation](https://your-docs-url)
   - [Plugin Development Guide](https://your-docs-url/plugins)

2. **Community**
   - [Issue Tracker](https://github.com/your-repo/genaicode/issues)
   - [Discussion Forum](https://github.com/your-repo/genaicode/discussions)

3. **Contributing**
   - [Contributing Guidelines](CONTRIBUTING.md)
   - [Code of Conduct](CODE_OF_CONDUCT.md)`;
