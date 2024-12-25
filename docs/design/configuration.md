# Configuration Options for GenAIcode Tool

The GenAIcode tool offers various configuration options to customize its behavior and adapt to different project requirements. This document outlines the configuration options available, focusing on the `.genaicoderc` file and lint command integration.

## .genaicoderc File

The `.genaicoderc` file is a JSON configuration file that allows you to set project-specific options for the GenAIcode tool. This file should be placed in the root directory of your project.

### Structure

The basic structure of the `.genaicoderc` file is as follows:

```json
{
  "rootDir": ".",
  "extensions": [...],
  "ignorePaths": [...],
  "lintCommand": "...",
  "customPrompts": {...},
  "modelOverrides": {...}
}
```

### Configuration Options

1. **rootDir**

   - **Type**: String
   - **Default**: "."
   - **Description**: Specifies the root directory of your project. All file paths will be relative to this directory.

2. **extensions**

   - **Type**: Array of Strings
   - **Default**: [".md", ".js", ".ts", ".tsx", ".css", ".scss", ".py", ".go", ".c", ".h", ".cpp"]
   - **Description**: Defines the file extensions that the tool should consider for code generation and analysis.
   - **Example**:
     ```json
     "extensions": [".js", ".ts", ".jsx", ".tsx", ".css"]
     ```

3. **ignorePaths**

   - **Type**: Array of Strings
   - **Default**: []
   - **Description**: Specifies directories or files that should be excluded from code analysis and generation.
   - **Example**:
     ```json
     "ignorePaths": ["node_modules", "dist", "build"]
     ```

4. **lintCommand**

   - **Type**: String
   - **Default**: null
   - **Description**: Specifies the command to run for linting the code before and after generation.
   - **Example**:
     ```json
     "lintCommand": "npm run lint"
     ```

5. **customPrompts**

   - **Type**: Object
   - **Default**: {}
   - **Description**: Allows defining custom prompts for specific file types or operations.
   - **Example**:
     ```json
     "customPrompts": {
       "reactComponent": "Create a React functional component with TypeScript",
       "apiEndpoint": "Generate an Express.js API endpoint with error handling"
     }
     ```

6. **modelOverrides**
   - **Type**: Object
   - **Default**: {}
   - **Description**: Allows overriding the default AI models used for each service.
   - **Example**:
     ```json
     "modelOverrides": {
       "chatGpt": {
         "cheap": "gpt-4o-mini",
         "default": "o1-preview"
       },
       "anthropic": {
         "cheap": "claude-3-haiku-20240307",
         "default": "claude-3-5-sonnet-20240620"
       },
       "vertexAi": {
         "cheap": "gemini-1.5-flash-001",
         "default": "gemini-1.5-pro-001"
       },
       "aiStudio": {
         "cheap": "gemini-1.5-flash-001",
         "default": "gemini-1.5-pro-001"
       }
     }
     ```

### Example .genaicoderc File

```json
{
  "rootDir": "src",
  "extensions": [".js", ".ts", ".jsx", ".tsx", ".css"],
  "ignorePaths": ["node_modules", "build", "test"],
  "lintCommand": "npm run lint",
  "modelOverrides": {
    "chatGpt": {
      "cheap": "gpt-4o-mini",
      "default": "o1-preview"
    },
    "anthropic": {
      "cheap": "claude-3-haiku-20240307",
      "default": "claude-3-5-sonnet-20240620"
    },
    "vertexAi": {
      "cheap": "gemini-1.5-flash-001",
      "default": "gemini-1.5-pro-001"
    },
    "aiStudio": {
      "cheap": "gemini-1.5-flash-001",
      "default": "gemini-1.5-pro-001"
    }
  }
}
```

## Lint Command Integration

The lint command integration allows the GenAIcode tool to maintain code quality by running linting before and after code generation.

### Configuration

The lint command is specified in the `.genaicoderc` file using the `lintCommand` property:

```json
{
  "lintCommand": "npm run lint"
}
```

### Usage

1. **Initial Lint Check**:

   - Before code generation, the tool runs the specified lint command to check for any existing issues.

2. **Post-Generation Lint**:

   - After code generation, the tool runs the lint command again to check the generated code.

3. **Lint Fix Process**:
   - If the post-generation lint fails, the tool attempts to fix the issues by:
     a. Capturing the lint error output.
     b. Sending the error information back to the AI model.
     c. Requesting code changes to fix the lint issues.
     d. Applying the suggested fixes.
     e. Running the lint command again to verify the fixes.

### Benefits

- Ensures that generated code adheres to project-specific coding standards.
- Maintains consistency between existing code and newly generated code.
- Reduces manual intervention needed to fix linting issues in generated code.

### Considerations

- The lint command should be compatible with your project's setup and return appropriate exit codes for success/failure.
- Ensure that the lint command is fast enough to run frequently, as it will be executed multiple times during the code generation process.
- Consider using a lint command that includes auto-fixing capabilities to streamline the process.

## CLI Overrides

Many of the configuration options set in the `.genaicoderc` file can be overridden using CLI flags when running the GenAIcode tool. This allows for flexibility in different scenarios without modifying the configuration file.

Example:

```
npx genaicode --dry-run --temperature 0.8
```

## Best Practices

1. **Version Control**: Include the `.genaicoderc` file in version control to ensure consistent configuration across the development team.

2. **Environment-Specific Configs**: For projects with different environments, consider creating multiple `.genaicoderc` files (e.g., `.genaicoderc.development`, `.genaicoderc.production`) and switching between them as needed.

3. **Regular Updates**: Periodically review and update your `.genaicoderc` file to ensure it aligns with your project's evolving needs and structure.

4. **Documentation**: Document any custom configurations or prompts in your project's README or documentation to help team members understand how the tool is set up for your specific project.
