We are adding new options to .genaicoderc

## Important context

This option will allow the user to specify context additions which should be always added to code generation, and should be never excluded by content mask, or ignore patterns.

Types of important context:

- text prompt: appended to codegen prompt
- file: content of this file should be always returned by getSourceCode

This context helps to guide the model for better results.
