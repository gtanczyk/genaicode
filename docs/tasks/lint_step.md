We need to refactor the usage of lint command.

Currently the lint command is executed before codegen, and after codegen. If it fails before codegen, we fail the process. If it fails after codegen, we try to run a prompt to recover from the problem.

While running the lint command before codegen works fine, there is a problem with lint after codegen. This lint is missing the context of change.

The solution is to supply the original context to the lint step.
