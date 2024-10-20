# File Operations in GenAIcode Tool

The GenAIcode tool supports various file operations to facilitate comprehensive code generation and management. This document outlines the supported file operations and their usage.

## Supported File Operations

1. **Creating New Files**

   - Activation: `--disallow-file-create` flag
   - Description: Disallows the tool to create new files within the project structure.

2. **Deleting Existing Files**

   - Activation: `--disallow-file-delete` flag
   - Description: Forbids the tool to remove existing files from the project.

3. **Creating New Directories**

   - Activation: `--disallow-directory-create` flag
   - Description: Disables the tool to create new directories in the project structure.

4. **Moving Files**

   - Activation: `--disallow-file-move` flag
   - Description: Disallows the tool to relocate files within the project structure.

5. **Updating Existing Files**
   - Activation: Always allowed
   - Description: Modifies the content of existing files in the project.
   - Use Case: Enhancing, refactoring, or fixing code in existing files.

## Usage and Control

These file operations are controlled by their respective CLI parameters and are executed based on the AI model's suggestions. The tool will only perform operations that are explicitly allowed through these flags.

## Safety Measures

1. **Dry Run Mode**:

   - Activation: `--dry-run` flag
   - Description: Simulates file operations without actually modifying the file system.
   - Use Case: Previewing changes before applying them.

2. **Scope Limitation**:

   - By default, the tool only operates within the specified project root directory.
   - This prevents unintended modifications to files outside the project scope.

3. **Confirmation Prompts**:

   - For critical operations like file deletion, the tool may prompt for user confirmation.

4. **Backup Recommendation**:
   - It's recommended to backup your project or use version control before running the tool with file modification capabilities enabled.

## Best Practices

1. **Incremental Approach**: Start with less invasive operations (like updating existing files) before enabling more substantial changes (like file creation or deletion).

2. **Version Control**: Always use version control systems to track changes and allow for easy rollback if needed.

3. **Review Changes**: Carefully review all suggested file operations before applying them, especially when using flags that allow for file creation, deletion, or moving.

4. **Use Dry Run**: Utilize the `--dry-run` flag to preview changes before actually applying them to your project.

5. **Backup**: Regularly backup your project, especially before running the tool with file modification capabilities enabled.

## Limitations

- The tool's ability to perform file operations is limited to the permissions granted to it through CLI flags.
- Complex refactoring operations that involve multiple interdependent file changes may require manual oversight.
- The tool does not handle version control operations (e.g., git commits) automatically.

By providing these file operation capabilities, GenAIcode offers a powerful way to not just generate code, but also manage and restructure projects. However, it's crucial to use these features judiciously and always verify the changes to ensure they align with your project goals and structure.
