# Additional Features of GenAIcode Tool

The GenAIcode tool offers several advanced features to enhance its code generation capabilities and provide a more flexible and powerful development experience. This document outlines these features and their usage.

## Dependency Tree Analysis

- **Activation**: `--dependency-tree` flag
- **Description**: Analyzes the dependencies of files marked with `@CODEGEN` and includes them in the code generation process.
- **Benefits**:
  - Ensures all relevant files are considered, even if not directly marked for code generation.
  - Provides a more comprehensive understanding of the codebase structure.
- **Limitation**: Currently only works for JavaScript/TypeScript codebases with ESM modules.
- **Use Case**: When modifying a component that other parts of the application depend on, this feature ensures that the changes are propagated correctly.

## Verbose Mode

- **Activation**: `--verbose-prompt` flag
- **Description**: Displays the prompts being sent to the AI model.
- **Use Cases**:
  - Debugging the code generation process.
  - Understanding how the tool constructs its requests to the AI model.
- **Benefits**: Provides transparency in the AI-assisted code generation process.
- **Example Output**: Might show the full context and instructions sent to the AI, including file contents and specific generation tasks.

## Context Optimization

- **Activation**: Enabled by default, can be disabled with `--disable-context-optimization` flag
- **Description**: Uses context paths to provide more efficient and focused code generation.
- **Benefits**:
  - Improves the relevance of generated code by considering the surrounding context.
  - Potentially reduces token usage by focusing on the most relevant parts of the codebase.
- **How it works**: The tool analyzes the project structure and dependencies to provide the AI model with the most relevant context for each code generation task.

## Requiring Explanations

- **Activation**: `--require-explanations` flag
- **Description**: Makes it mandatory for the AI model to provide explanations for all code generation operations.
- **Benefits**:
  - Enhances understanding of the AI's decision-making process.
  - Useful for learning and improving code quality.
- **Consideration**: May consume more tokens, potentially increasing costs.
- **Example**: The AI might explain why it chose a particular design pattern or why it refactored code in a specific way.

## Vision Capabilities

- **Activation**: `--vision` flag
- **Description**: Enables the tool to process and analyze image inputs for code generation tasks.
- **Compatible Models**: Primarily designed for use with Vertex AI's Gemini Pro Vision.
- **Use Cases**:
  - Generating UI code based on design mockups or screenshots.
  - Creating image processing algorithms based on example images.
  - Developing computer vision related code with visual references.
- **Considerations**:
  - May increase token usage and processing time.
  - Effectiveness depends on the quality and relevance of input images.

## Temperature Control

- **Activation**: `--temperature` parameter (default: 0.7)
- **Description**: Allows adjustment of the AI model's creativity level.
- **Range**: 0.0 to 2.0
  - Lower values: More focused and deterministic outputs.
  - Higher values: More creative and diverse outputs.
- **Use Cases**:
  - Fine-tuning the balance between consistency and creativity in generated code.
- **Example**: A lower temperature might be used for generating standard boilerplate code, while a higher temperature could be used for coming up with creative solutions to complex problems.

## Configurable File Extensions

- **Configuration**: Via `.genaicoderc` file
- **Description**: Allows specifying which file extensions should be considered during code generation and analysis.
- **Default Extensions**: [".md", ".js", ".ts", ".tsx", ".css", ".scss", ".py", ".go", ".c", ".h", ".cpp"]
- **Benefits**:
  - Customizable to project-specific needs.
  - Improves performance by focusing on relevant file types.
- **Example Configuration**:
  ```json
  {
    "extensions": [".js", ".ts", ".jsx", ".tsx", ".css"]
  }
  ```

## Ignore Paths

- **Configuration**: Via `.genaicoderc` file
- **Description**: Specifies directories or files to be excluded from code analysis and generation.
- **Benefits**:
  - Improves performance by skipping irrelevant directories (e.g., `node_modules`).
  - Allows focusing on specific parts of the project.
- **Example Configuration**:
  ```json
  {
    "ignorePaths": ["node_modules", "dist", "build"]
  }
  ```

## Lint Command Integration

- **Configuration**: Via `.genaicoderc` file
- **Description**: Specifies a lint command to be run before and after code generation.
- **Features**:
  - Initial lint check (can be disabled with `--disable-initial-lint` flag).
  - Post-generation lint check.
  - Automatic lint fix attempts for failed checks.
- **Benefits**:
  - Ensures generated code adheres to project-specific coding standards.
  - Maintains code quality throughout the generation process.
- **Example Configuration**:
  ```json
  {
    "lintCommand": "npm run lint"
  }
  ```

## Dry Run Mode

- **Activation**: `--dry-run` flag
- **Description**: Simulates the code generation process without actually modifying any files.
- **Benefits**:
  - Allows preview of changes before applying them.
  - Useful for testing and understanding the tool's behavior.
- **Output**: Displays what changes would be made without actually making them.

## Image Generation (Imagen)

- **Activation**: `--imagen` flag
- **Description**: Enables the tool to generate images using AI models as part of the code generation process.
- **Purpose**: To create and integrate visual assets directly within the development workflow.
- **How to Use**:
  1. Activate the feature by including the `--imagen` flag when running GenAIcode.
  2. In your prompts or code comments, you can request image generation using specific syntax or functions.
  3. The tool will use an AI image generation service (e.g., DALL-E) to create the requested image.
  4. The generated image will be saved in the specified location within your project structure.
- **Use Cases**:
  - Generating placeholder images for UI components.
  - Creating custom icons or graphics based on textual descriptions.
  - Producing visual assets for documentation or testing purposes.
- **Limitations and Considerations**:
  - Image generation may increase processing time and resource usage.
  - The quality and relevance of generated images depend on the specificity and clarity of the prompts.
  - There may be usage limits or additional costs associated with the image generation service.
  - Generated images should be reviewed for appropriateness and may require manual adjustments.
- **Integration with Other Features**: The imagen feature can be used in conjunction with the vision capabilities, allowing for a workflow where generated images can be immediately analyzed and incorporated into the code generation process.

These features collectively make GenAIcode a versatile and powerful tool for AI-assisted code generation, capable of adapting to various project requirements and development workflows. By leveraging these features, developers can fine-tune the code generation process to their specific needs, ensuring high-quality, context-aware, and project-compliant code outputs.
