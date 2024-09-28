# Dependency Tree Feature

Status: Implemented

This task added a dependency tree feature to the GenAIcode tool. It introduced a new `--dependency-tree` option that analyzes the codebase to determine file dependencies. When used with the `@CODEGEN` feature, it limits the source code included in the AI prompt to only relevant files, reducing token usage and potentially lowering costs for AI services like ChatGPT or Vertex AI.
