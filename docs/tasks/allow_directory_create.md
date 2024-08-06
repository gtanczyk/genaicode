# Summary

Add support for directory creation

# Description

We want to have support for directory creation, so that the user can specify argument `--allow-directory-create`.
If the argument is specified the codegen will be allowed to create directories.

Implementation plan:

- update `cli-param.js`, and `validate-cli-params.js` with the new argument
- update `function-calling.js` with `createDirectory` function definition
- update `systemprompt.js` with `createDirectory` function definition
- update `prompt-codegen.js` with mention of `createDirectory` function
- update vertex-ai code to understand `createDirectory`
- update `update-files.js` to understand `createDirectory`
