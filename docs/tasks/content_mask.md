# Summary

New feature: content mask

# Description

## Background

The initial generateContent request may be very big in terms of number fo tokens. The number is growing together with the source code of the application where genaicode is used.
In such case we want to unblock the user with an option to apply an ad-hoc filter that will limit the number of source code files where the content is provided in the initial request.
The model may still request the content using in the codegenSummary response with the contextPaths parameter

## Requirements

- new cli option is supported: --content-mask=...
- when provided, the value should be printed to the console
- it should be used in readSourceFiles function, when content mask is provided only put the content to the result if the path matches the content mask
- content mask is a prefix of the path relative to rootDir from read-files
- content mask value should be validated, it is expected to match some existing directory from the project source code
- content mask feature is covered with unit tests
- it is described in readme, and in features.md

## Unit test coverage

- read-files.js logic must be covered with unit tests
- content mask cli param validation coverage
