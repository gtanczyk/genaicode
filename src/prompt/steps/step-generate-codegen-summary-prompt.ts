export const PROMPT_CODEGEN_SUMMARY_ASSISTANT =
  'I will now generate a summary of the proposed updates. Do you have any guidance or preferences for the summary?';

export const PROMPT_CODEGEN_SUMMARY = `# Guidelines for Code Generation Summary

## Guidelines for Determining Update Tool

## updateFile
- **Use when**:
  - Making significant, structural changes to a file that require a complete rewrite or substantial modifications across multiple parts of the file.
  - Adding or removing large sections of code, or when the modifications are not easily expressed as a patch.
  - The file is of reasonable size and does not approach token limits.
  - The changes require a complete understanding of the file's context, and it's simpler to replace the entire content.

- **Do not use when**:
  - The changes are small and localized, and can be accurately described with a patch.
  - The file is very large, and replacing the entire content would be inefficient or exceed token limits.
  - The changes are simple line additions, deletions, or minor edits.
  - The file has complex formatting that might be disturbed by a complete rewrite.

## patchFile
- **Use when**:
  - Making very small, targeted, line-specific edits.
  - Modifying a few lines in the file, adding or deleting code, or fixing minor errors.
  - Working with large files where replacing the entire file would be inefficient.
  - The changes are easily expressed as a patch with line numbers.
  - There is no need to understand the entire file content.

- **Do not use when**:
  - The changes involve significant structural modifications or large content replacements.
  - The required patch would be too complex or unreadable.
  - The edits involve substantial changes that may affect other parts of the file.
  - There are large blocks of code that need to be moved or changed.

## createFile
- **Use when**:
  - Adding an entirely new file to the project, including new configuration files, code modules, or assets.
  - Creating a new file that has no existing counterpart in the project.
  - Implementing new features or components that require dedicated files.
  - Creating a file in a new directory.

- **Do not use when**:
  - Modifying the contents of an existing file (use \`updateFile\` or \`patchFile\`).
  - Renaming an existing file (use \`moveFile\`).
  - Moving a file to a different location (use \`moveFile\`).

## deleteFile
- **Use when**:
  - Removing a file that is no longer needed or is obsolete.
  - Cleaning up unused code or configuration files.
  - Removing a file before moving it to another location or replacing it with a new one.

- **Do not use when**:
  - Temporarily disabling code (use comments or conditional compilation instead).
  - Making changes to the file content (use \`updateFile\` or \`patchFile\`).
  - Moving the file to a new location (use \`moveFile\`).

## moveFile
- **Use when**:
  - Changing the location of a file within the project, while preserving its content.
  - Refactoring the project structure by moving files to different directories.
  - Renaming the file or its directory.

- **Do not use when**:
  - Modifying the contents of the file (use \`updateFile\` or \`patchFile\`).
  - Creating a new file with similar content (use \`createFile\`).
  - Deleting the file (use \`deleteFile\`).

## createDirectory
- **Use when**:
  - Creating a new directory in the project structure.
  - Organizing files into logical groups.
  - Preparing a location for new files to be created.

- **Do not use when**:
  - Modifying file contents (use \`updateFile\` or \`patchFile\`).
  - Moving files (use \`moveFile\`).
  - Deleting files or directories (use \`deleteFile\`).

## downloadFile
- **Use when**:
  - Downloading a file from a remote source to the project.
  - Fetching external resources required by the application.
  - Integrating external data or assets.

- **Do not use when**:
  - Modifying existing files in the project (use \`updateFile\` or \`patchFile\`).
  - Creating new files (use \`createFile\`).
  - Moving files within the project (use \`moveFile\`).

## splitImage
- **Use when**:
  - Dividing an image into smaller parts or regions.
  - Extracting specific portions of an image for further analysis or processing.
  - Preparing image assets for different display contexts.

- **Do not use when**:
  - The task does not involve image manipulation.
  - Modifying files or code.
  - The image does not need to be divided.

## resizeImage
- **Use when**:
  - Adjusting the dimensions of an image.
  - Optimizing image sizes for different platforms or resolutions.
  - Preparing images for display in various UI components.

- **Do not use when**:
  - The task does not involve image manipulation.
  - Modifying files or code.
  - The image dimensions do not need to be changed.

## imglyRemoveBackground
- **Use when**:
  - Removing the background from an image.
  - Isolating the main subject of an image.
  - Preparing images for use in creative contexts.

- **Do not use when**:
  - The task does not involve image manipulation.
  - Modifying files or code.
  - The image background does not need to be removed.

## General Principles

- **Choose the most precise tool**: Select the tool that best matches the required action (e.g., \`patchFile\` for small edits, \`updateFile\` for large changes).
- **Minimize changes**: Avoid unnecessary modifications and use the tool that makes the smallest changes necessary.
- **Preserve structure**: Maintain the existing code structure and formatting whenever possible, especially when using \`patchFile\`.
- **Consider file size**: Use \`patchFile\` for large files and \`updateFile\` for smaller files to avoid token limits.
- **Prioritize clarity**: Choose the tool that results in clear, maintainable code changes, and avoid complex patches when simpler options exist.
- **Context awareness**: When making changes, ensure that the context is sufficient to understand the file and the changes.
- **Ensure the directory structure**: When creating a new file, ensure the parent directory exists. If not create it first using \`createDirectory\`, and then create the file.

`;
