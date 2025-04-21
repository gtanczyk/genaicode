export const GENAICODE_HELP_DOCUMENT = `# GenAIcode Help Documentation

## Overview

GenAIcode is an AI-powered code generation and management tool designed to streamline software development. It leverages various AI services (Vertex AI, AI Studio, OpenAI, Anthropic) to generate, modify, and analyze code. The tool supports both interactive CLI and web UI modes, offering features like code generation, image processing, and context optimization.

## Quick Start

1. Installation:
   \`\`\`bash
   npm install -g genaicode
   \`\`\`

2. Basic Usage:
   \`\`\`bash
   genaicode "Your prompt here"
   \`\`\`

3. UI Mode:
   \`\`\`bash
   genaicode --ui
   \`\`\`

## Core Features

### AI Services Integration

- **Supported Services**:
  - Vertex AI (with Gemini Pro)
  - OpenAI (GPT-4)
  - Anthropic (Claude)
  - AI Studio
  - Custom Plugin Services

- **Service Auto-detection**: Automatically detects available AI services based on environment configuration
- **Fallback Mechanism**: Handles service failures with automatic fallback options
- **Model Configuration**: Supports per-service model configuration via .genaicoderc

### Interaction Modes

1. **UI Mode**:
   - Web-based interface
   - Real-time updates
   - Visual diff viewing
   - Progress tracking
   - File operation preview

2. **Interactive CLI**:
   - Command-line interface
   - Step-by-step guidance
   - Task file support
   - Operation control

### File Operations

- Create/Update/Delete files
- Move files
- Create directories
- Patch files
- Context-aware operations
- Safety checks and validation

### Image Processing

- **Generation**: Create images using AI services
- **Analysis**: Vision model support for image context
- **Manipulation**:
  - Background removal
  - Image splitting
  - Resizing
  - Format conversion

### Context Management

- Smart context optimization
- History tracking and summarization
- Token usage optimization
- Conversation continuation
- Cache management

## Configuration

### .genaicoderc Options

\`\`\`json
{
  "rootDir": ".",
  "ignorePaths": ["node_modules", "dist"],
  "lintCommand": "npm run lint",
  "importantContext": {
    "systemPrompt": [],
    "files": []
  },
  "plugins": [],
  "modelOverrides": {
    "aiStudio": {
      "default": "gemini-pro",
      "cheap": "gemini-pro-vision"
    }
  }
}
\`\`\`

### CLI Options

- \`--verbose-prompt\`: Enable detailed prompt logging
- \`--dry-run\`: Simulate operations without making changes
- \`--temperature\`: Control AI response randomness
- \`--vision\`: Enable image analysis
- \`--imagen\`: Enable image generation
- \`--cheap\`: Use cost-optimized models
- \`--ui\`: Launch web interface
- \`--ui-port\`: Specify UI port
- \`--content-mask\`: Filter context
- \`--disable-cache\`: Disable caching
- \`--disable-history\`: Disable history tracking

## Plugin System

### Types of Plugins

1. **AI Service Plugins**:
   - Custom AI service integration
   - Model configuration
   - Response handling

2. **Action Handlers**:
   - Custom operations
   - User interaction
   - File processing
   - Git context retrieval (\`requestGitContext\` for commits, file changes, blame)

3. **Operation Extensions**:
   - File operations
   - Image processing
   - Analysis tools

### Creating Plugins

Basic plugin structure:
\`\`\`typescript
export default {
  name: "my-plugin",
  aiServices?: {
    [key: string]: {
      generateContent: GenerateContentFunction;
      serviceConfig: ServiceConfig;
    }
  },
  operations?: {
    [key: string]: Operation;
  },
  actionHandlers?: {
    [key: string]: {
      handler: ActionHandler;
      description: string;
    }
  }
}
\`\`\`

## Best Practices

1. **Code Generation**:
   - Provide clear, specific prompts
   - Review generated code before applying
   - Use appropriate temperature settings
   - Leverage context optimization

2. **File Management**:
   - Use absolute paths
   - Verify file operations
   - Handle dependencies properly
   - Maintain consistent structure

3. **Context Optimization**:
   - Keep relevant files in context
   - Remove unnecessary content
   - Use content masking when needed
   - Monitor token usage

4. **Error Handling**:
   - Check operation results
   - Handle service failures
   - Validate generated code
   - Use appropriate fallback options

## Troubleshooting

### Common Issues

1. **AI Service Connection**:
   - Verify API keys
   - Check service availability
   - Confirm network connection
   - Review rate limits

2. **File Operations**:
   - Check file permissions
   - Verify paths
   - Review operation logs
   - Confirm file existence

3. **Context Problems**:
   - Monitor token usage
   - Review context optimization
   - Check file inclusion
   - Verify content masks

4. **Plugin Issues**:
   - Validate plugin structure
   - Check compatibility
   - Review error logs
   - Update dependencies

### Getting Help

- Use the \`--help\` command
- Check documentation
- Review error messages
- Contact support

## Advanced Topics

### Custom Actions

Creating custom actions:
\`\`\`typescript
export const myCustomAction: ActionHandler = async (props) => {
  // Implementation
};
\`\`\`

### Hook System

Available hooks:
- Pre/post operation
- Generate content
- Planning
- Context optimization

### Project Profiles

Supported frameworks:
- JavaScript/TypeScript
- Python
- Java
- Go
- React

## Security Considerations

1. **API Keys**:
   - Secure storage
   - Regular rotation
   - Access control
   - Environment variables

2. **File Operations**:
   - Permission checks
   - Path validation
   - Content verification
   - Operation logging

3. **Plugin Security**:
   - Source verification
   - Dependency scanning
   - Permission management
   - Code review

## Updates and Maintenance

- Regular updates
- Security patches
- Feature additions
- Bug fixes
- Documentation updates

## Support

For additional help:
- GitHub Issues
- Documentation
- Community Forums
- Support Channels
`;
