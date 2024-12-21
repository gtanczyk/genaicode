# Design Document for GenAIcode Tool

Welcome to the design documentation for the GenAIcode tool. This document provides an overview of the tool's architecture, components, and features. For detailed information on specific aspects of the tool, please refer to the following sections:

1. [Overview](./overview.md)
2. [File Operations](./file_operations.md)
3. [Features](./features.md)
4. [Configuration](./configuration.md)
5. [Implementation Status](./feature-implementation-status.md)

## Quick Start

The GenAIcode tool is designed to automate code generation tasks using state-of-the-art AI models (including Gemini Pro, GPT-4, and Claude 3). It enhances developer productivity by assisting with code generation tasks while providing flexibility in choosing the AI service that best suits the project's needs. The tool supports both interactive CLI and web-based UI modes, with extensive configuration options and plugin support.

## Architecture

GenAIcode is built with a modular, extensible architecture that enables easy integration of various AI models and customization through plugins. The architecture consists of several key components that work together to provide a robust code generation system:

### Core Components

1. **AI Services Layer**

   - Integrates with multiple AI models:
     - Vertex AI (Gemini Pro)
     - OpenAI GPT-4
     - Anthropic Claude 3
     - AI Studio (Gemini Pro)
     - Custom plugin-based services
   - Features:
     - Model-specific communication handlers
     - Automatic service fallback mechanism
     - Rate limit handling
     - Token usage optimization
     - Model configuration management
   - Implementation: `src/ai-service/*`

2. **Content Management System**

   - Handles all content-related operations:
     - Context optimization
     - Token usage management
     - Content masking
     - Source code tree management
     - Cache management
   - Features:
     - Smart context selection
     - Token usage optimization
     - Dependency analysis
     - Content summarization
   - Implementation: `src/prompt/steps/*`, `src/files/*`

3. **Operation System**

   - Manages file and image operations:
     - File creation/update/delete
     - Directory management
     - Image processing
     - Operation validation
   - Features:
     - Path resolution and validation
     - Safety checks
     - Dependency tracking
     - Operation rollback support
   - Implementation: `src/operations/*`, `src/images/*`

4. **Plugin System**
   - Provides extensibility through plugins:
     - Custom AI services
     - Operation extensions
     - Action handlers
     - Project profiles
   - Features:
     - Dynamic plugin loading
     - Hook system
     - Configuration management
     - Service integration
   - Implementation: `src/main/plugin-loader.ts`

### User Interface Components

5. **UI Mode**

   - Web-based interface implementation:
     - Real-time interaction
     - Visual feedback
     - File management
     - Progress tracking
   - Features:
     - Modern web interface
     - Real-time updates
     - File upload support
     - Operation progress visualization
   - Implementation: `src/main/ui/*`

6. **Interactive Mode**
   - CLI-based interaction system:
     - Command processing
     - User input handling
     - Task execution
     - Progress reporting
   - Features:
     - Text prompt support
     - Task file processing
     - Configuration management
     - Operation control
   - Implementation: `src/main/interactive/*`

### Support Components

7. **History Management**

   - Manages conversation history:
     - History tracking
     - Context preservation
     - Summarization
     - Cache management
   - Features:
     - Efficient storage
     - Token optimization
     - Context preservation
     - Conversation continuation
   - Implementation: `src/prompt/steps/step-history-update.ts`, `src/prompt/steps/step-summarization.ts`

8. **Configuration System**

   - Handles tool configuration:
     - CLI parameters
     - Project settings
     - Service configurations
     - Plugin management
   - Features:
     - Environment detection
     - Profile management
     - Plugin configuration
     - Service settings
   - Implementation: `src/main/config-lib.ts`, `src/project-profiles/*`

9. **Project Profiles**
   - Framework-specific configurations:
     - Project type detection
     - Default settings
     - Framework integration
     - Custom profiles
   - Features:
     - Automatic detection
     - Framework-specific settings
     - Custom profile support
     - Plugin extensibility
   - Implementation: `src/project-profiles/*`

## Component Relationships

The components interact through well-defined interfaces:

1. **AI Services Integration**

   ```
   UI/CLI → Content Management → AI Services
                ↓
           Operation System
   ```

2. **Plugin Integration**

   ```
   Plugin System → [AI Services, Operations, Actions]
         ↓
   Configuration System
   ```

3. **History Management**

   ```
   Content Management → History Management → Cache
           ↓
   Context Optimization
   ```

4. **Operation Flow**
   ```
   User Input → Content Management → AI Services
       ↓
   Operation System → File System
   ```

## Features

The tool provides extensive features for code generation:

1. **AI Integration**

   - Multiple AI service support
   - Automatic fallback
   - Model configuration
   - Token optimization

2. **User Interface**

   - Web-based UI
   - Interactive CLI
   - Task file support
   - Progress tracking

3. **Content Management**

   - Context optimization
   - Token management
   - Content masking
   - Cache control

4. **File Operations**

   - Comprehensive file handling
   - Image processing
   - Path validation
   - Safety checks

5. **Plugin Support**
   - Custom AI services
   - Operation extensions
   - Action handlers
   - Project profiles

For a complete list of features and their implementation status, refer to [Features](./features.md) and [Implementation Status](./feature-implementation-status.md).

## Configuration

The tool supports extensive configuration through:

1. **CLI Parameters**

   - Operation control
   - Feature toggles
   - Service selection
   - Debug options

2. **Configuration File**

   - Project settings
   - Service configurations
   - Plugin management
   - Framework settings

3. **Environment Variables**

   - API keys
   - Service settings
   - Debug options
   - Path configurations

4. **Project Profiles**
   - Framework detection
   - Default settings
   - Custom configurations
   - Plugin integration

Refer to [Configuration](./configuration.md) for detailed configuration options.

## Plugin Development

To develop plugins for GenAIcode:

1. **Plugin Types**

   - AI Service plugins
   - Operation plugins
   - Action handler plugins
   - Project profile plugins

2. **Implementation**

   - Follow plugin interface
   - Use provided utilities
   - Implement required methods
   - Add configuration support

3. **Testing**

   - Unit tests
   - Integration tests
   - Example implementations
   - Documentation

4. **Distribution**
   - Package configuration
   - Dependency management
   - Version control
   - Documentation

Examples available in `examples/genaicode_plugins/`.

## Roadmap

Future development plans include:

1. **Error Handling**

   - Enhanced recovery
   - Better reporting
   - Operation rollback
   - Validation improvements

2. **User Experience**

   - Sound notifications
   - Diff visualization
   - Operation preview
   - Enhanced progress tracking

3. **Integration**

   - Ollama support
   - Additional AI services
   - Framework integrations
   - Tool integrations

4. **Plugin System**
   - Marketplace support
   - Version management
   - Enhanced documentation
   - More examples

## License

GenAIcode is licensed under the Apache License 2.0. See the [LICENSE](../../LICENSE) file for the complete license text.

## Contact

For questions, support, or feedback use GitHub Issues.
