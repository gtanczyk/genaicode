# Summary

Configurable file extensions

# Description

Currently genaicode has a hardcoded list of recognized file extensions: .md, .js, .ts, .tsx, .css

Also the dependency tree feature recognizes only two extensions: .ts, and .tsx

This should become a configuration option in `.genaicoderc`, lets call it `"extensions"`

Here is an example of `.genaicoderc`:

```json
{
  "rootDir": ".",
  "extensions": [".md", ".js", ".ts", ".tsx", ".css"]
}
```

## Other requirements

- this new option should be used in `find-files.js`.
- the new option should optional and the default value should be: `[".md", ".js", ".ts", ".tsx", ".css", ".scss", ".py", ".go", ".c", ".h", ".cpp"]`
- the new option should be mentioned in README.md and in the genaicode design doc.
- the dependency tree feature should described as currently only works for javascript/typescript codebases with ESM modules
