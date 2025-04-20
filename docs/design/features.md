# Features of GenAIcode Tool

The GenAIcode tool offers a comprehensive set of features designed to enhance code generation capabilities and provide a flexible development experience. This document outlines all available features, their configuration, and usage.

## Core Features

### Interactive Mode

- **Activation**: Default mode when using `--interactive` flag
- **Description**: Enables conversation-driven code generation with real-time feedback
- **Features**:
  - Real-time clarification through questions
  - Context-aware interactions
  - Multi-step operation support
  - Continuous conversation flow
- **Benefits**:
  - Enhanced understanding of requirements
  - More accurate code generation
  - Better error handling
  - Improved user experience

### UI Mode

- **Activation**: `--ui` flag
- **Description**: Provides a web-based graphical interface for code generation
- **Features**:
  - Real-time interaction
  - Visual feedback for operations
  - File upload support
  - Image handling capabilities
  - Conversation history visualization
- **Configuration**:
  ```json
  {
    "uiPort": 3000,
    "uiFrameAncestors": ["http://localhost:3000"]
  }
  ```
- **Benefits**:
  - User-friendly interface
  - Visual operation feedback
  - Enhanced file management
  - Improved accessibility

### History Management

- **Activation**: Enabled by default, can be disabled with `--disable-history` flag
- **Description**: Manages conversation history and context preservation
- **Features**:
  - Conversation tracking
  - Context preservation
  - History summarization
  - Configurable retention
- **Related Options**:
  - `--disable-conversation-summary`: Disables automatic conversation summarization
- **Benefits**:
  - Improved context awareness
  - Better conversation continuity
  - Reduced token usage
  - Enhanced user experience

### Plugin System

- **Activation**: Automatic when plugins are configured
- **Description**: Enables extensibility through custom plugins
- **Features**:
  - Custom AI service integration
  - Action handler extensions
  - Operation customization
  - Hook system
- **Configuration**:
  ```json
  {
    "plugins": ["my-custom-plugin", "./local-plugin.js"]
  }
  ```
- **Benefits**:
  - Enhanced extensibility
  - Custom functionality
  - Integration capabilities
  - Operation flexibility

## Operation Features

### Context Optimization

- **Activation**: Enabled by default, can be disabled with `--disable-context-optimization` flag
- **Description**: Optimizes context handling for improved performance
- **Features**:
  - Smart context selection
  - Token usage optimization
  - Dependency analysis
  - Content masking
- **Benefits**:
  - Reduced token usage
  - Improved performance
  - Better accuracy
  - Cost optimization

### Vision Capabilities

- **Activation**: `--vision` flag
- **Description**: Enables image processing and analysis
- **Compatible Models**: Vertex AI's Gemini Pro Vision
- **Use Cases**:
  - UI code generation from mockups
  - Image processing algorithms
  - Visual reference-based development
- **Benefits**:
  - Enhanced visual understanding
  - Improved UI development
  - Better visual context handling

### Image Generation (Imagen)

- **Activation**: `--imagen` flag
- **Description**: Enables AI-powered image generation
- **Supported Services**:
  - DALL-E
  - Vertex AI Imagen
- **Features**:
  - Custom image generation
  - Visual asset creation
  - Image modification
- **Benefits**:
  - Integrated asset creation
  - Visual content generation
  - Enhanced development workflow

### Git Context Integration

- **Activation**: Enabled by default when Git is available
- **Description**: Allows the AI model to request context from the project's Git history.
- **Features**:
  - Request recent commit history.
  - Request commit history for specific files.
  - Request `git blame` output for specific files (and optionally commits).
- **Usage**: The AI uses the `requestGitContext` action via the `askQuestion` function.
- **Benefits**:
  - Provides the AI with deeper understanding of code evolution.
  - Improves the AI's ability to reason about changes and maintain consistency.

## Configuration Features

### Model Overrides

- **Configuration**: Via `.genaicoderc`
- **Description**: Allows customization of AI model behavior
- **Options**:
  ```json
  {
    "modelOverrides": {
      "temperature": 0.7,
      "maxTokens": 4096
    }
  }
  ```
- **Benefits**:
  - Fine-tuned responses
  - Custom behavior
  - Improved control

### Important Context

- **Configuration**: Via `.genaicoderc`
- **Description**: Defines critical context for code generation
- **Example**:
  ```json
  {
    "importantContext": ["src/core/**/*.ts", "README.md"]
  }
  ```
- **Benefits**:
  - Better context awareness
  - Improved accuracy
  - Focused generation

### AI Service Fallback

- **Activation**: Enabled by default, can be disabled with `--disable-ai-service-fallback`
- **Description**: Provides automatic fallback between AI services
- **Features**:
  - Automatic service switching
  - Error recovery
  - Service availability monitoring
- **Benefits**:
  - Improved reliability
  - Continuous operation
  - Error resilience

## CLI Features

### Verbose Mode

- **Activation**: `--verbose-prompt` flag
- **Description**: Displays detailed prompts and interactions
- **Benefits**:
  - Debugging assistance
  - Process transparency
  - Better understanding

### Temperature Control

- **Activation**: `--temperature` parameter (default: 0.7)
- **Range**: 0.0 to 2.0
- **Usage**: Fine-tunes AI response creativity
- **Benefits**:
  - Controlled creativity
  - Consistent output
  - Task-appropriate responses

### Content Mask

- **Activation**: `--content-mask=<path>` parameter
- **Description**: Filters initial source code context
- **Benefits**:
  - Reduced token usage
  - Focused context
  - Improved performance

### Cost Optimization

- **Activation**: `--cheap` flag
- **Description**: Uses cost-effective AI models
- **Benefits**:
  - Reduced costs
  - Faster processing
  - Resource optimization

## File Operation Features

### File Management

- **Permissions**:
  - `--allow-file-create`
  - `--allow-file-delete`
  - `--allow-directory-create`
  - `--allow-file-move`
- **Operations**:
  - File creation/deletion
  - Directory management
  - File movement
  - Content updates
- **Benefits**:
  - Comprehensive file handling
  - Safe operations
  - Flexible management

### Lint Integration

- **Configuration**: Via `.genaicoderc`
- **Description**: Integrates with project linting
- **Example**:
  ```json
  {
    "lintCommand": "npm run lint"
  }
  ```
- **Benefits**:
  - Code quality maintenance
  - Standard compliance
  - Automated checking

## Additional Features

### Dry Run Mode

- **Activation**: `--dry-run` flag
- **Description**: Simulates operations without changes
- **Benefits**:
  - Safe testing
  - Operation preview
  - Risk mitigation

### Cache Control

- **Activation**: `--disable-cache` flag
- **Description**: Controls caching behavior
- **Benefits**:
  - Fresh results
  - Controlled caching
  - Improved accuracy

These features collectively make GenAIcode a versatile and powerful tool for AI-assisted code generation, capable of adapting to various development workflows and requirements. Each feature can be configured and combined to create an optimal development experience.
