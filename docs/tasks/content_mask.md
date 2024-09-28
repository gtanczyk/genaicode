# Content Mask Feature

Status: Implemented

This task added a content mask feature to the GenAIcode tool. It introduced a new CLI option `--content-mask` that allows users to apply an ad-hoc filter, limiting the number of source code files included in the initial AI request. This feature helps manage token usage for large projects by focusing the AI's attention on specific parts of the codebase while still allowing access to other files if needed.
