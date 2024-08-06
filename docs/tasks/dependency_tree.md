# Summary

Dependency tree feature for codegen

# Description

We are adding --dependency-tree feature to codegen. This feature should take the codegen files and calculate their dependency tree.
Once we know the dependency tree, the source code (getSourceCode function) should be limited only to those files.

The idea is that when the --consider-all-files feature is not used, and we are using the `@CODEGEN` feature, we want to build prompt using only those files which are relevant.

This way we will limit the token usage, because the system prompt will be smaller, and therefore we will pay less for ChatGPT or Vertex AI

## Implementation

We need to update the `find-files.js` and `prompt-codegen.js` files to support the --dependency-tree feature.

Update `find-files.js` to include a method `getDependencyTree` to find the dependencies of a given file.

Make sure to update validation of cli parameters, and the README of codegen - use the existing convention for handling ofcli params.
