# Design Doc: Refined External Project Exploration Strategy

**Author:** GenAIcode Assistant
**Date:** 2025-04-05
**Status:** Proposed

## 1. Introduction

This document outlines a refined strategy for GenAIcode to explore and analyze projects located outside its configured root directory. This addresses limitations identified where the assistant failed to correctly process the output of the `exploreExternalDirectories` tool to inform subsequent calls to `readExternalFiles`, leading to inaccurate or failed file reading attempts.

## 2. Problem Statement

When tasked with analyzing an external project, the assistant needs to perform a sequence of actions:

1.  Explore the external directory structure (`exploreExternalDirectories`).
2.  Understand the structure and identify key files based on the exploration results.
3.  Request the content of relevant files (`readExternalFiles`).
4.  Analyze the content and provide insights.

The current implementation sometimes fails at step 2, leading to incorrect file requests in step 3 (e.g., requesting non-existent files or files not relevant to the exploration results).

## 3. Proposed Solution: Refined Prompt Engineering & Workflow

The proposed solution involves enhancing the system prompt and guiding the LLM to follow a stricter, more logical workflow:

**Key Principles:**

- **Output Parsing Priority:** Mandate parsing and understanding `exploreExternalDirectories` output _before_ deciding on the next action.
- **Conditional Logic:** Base subsequent actions (read files, explore further, ask user) explicitly on the _type_ and _content_ of the exploration results (`filePaths` vs. `synthesis` vs. `error`).
- **Information Linkage:** Ensure `readExternalFiles` requests are directly derived from the files identified by `exploreExternalDirectories`.
- **Synthesis Interpretation:** Guide the LLM to use `synthesis` for understanding general structure and informing _further exploration_, not for guessing exact file paths to read.
- **Iterative Refinement:** Frame the process as potentially iterative (explore -> read -> maybe explore deeper -> read more).

**Specific Prompt Instructions (Summary):**

- Detailed guidance on handling different `exploreExternalDirectories` outcomes (`filePaths` present, `synthesis` present, `error` present).
- Strict rules for formulating `readExternalFiles` requests based _only_ on confirmed or highly probable file paths from exploration.
- Emphasis on providing clear `reason` arguments for tool calls.
- Instructions for processing `readExternalFiles` results, including errors.
- Guidance on using common project patterns only _after_ examining the specific project structure revealed by exploration.

(Refer to the reasoning inference results from the conversation on 2025-04-05 for the full detailed instructions).

## 4. Integration with Conversation Graph

The multi-step, conditional nature of this refined workflow makes it an ideal candidate for implementation using the `conversationGraph` tool.

**Potential Graph Structure:**

- **Start Node:** User requests external project analysis.
- **Node 1:** Call `exploreExternalDirectories` with initial parameters.
- **Edge (Conditional):** Based on `exploreExternalDirectories` response:
  - **Edge to Node 2a (File Paths):** If `filePaths` received -> Process file list.
  - **Edge to Node 2b (Synthesis):** If `synthesis` received -> Process synthesis.
  - **Edge to Node 2c (Error):** If `error` received -> Handle error.
  - **Edge to Node 2d (No Results):** If no results -> Inform user.
- **Node 2a (Process File Paths):** LLM decides which files from the list are relevant.
  - **Edge:** Call `readExternalFiles` with selected paths.
- **Node 2b (Process Synthesis):** LLM decides next step (explore deeper, ask user, potentially infer standard file).
  - **Edge (Explore Deeper):** Call `exploreExternalDirectories` with refined parameters (back to Node 1 logic).
  - **Edge (Ask User):** Call `askQuestion` (`sendMessage`).
  - **Edge (Read Inferred):** Call `readExternalFiles` (carefully).
- **Node 3 (Process Read Results):** LLM receives `readExternalFiles` response.
  - **Edge:** Integrate content, proceed with analysis, potentially loop back for more reading/exploration if needed.
- **End Node:** Provide final analysis/response to the user.

This structured approach using `conversationGraph` would enforce the desired workflow and conditional logic more reliably than relying solely on prompt instructions within a single turn.

## 5. Implementation Considerations

- Update the system prompt in `src/prompt/systemprompt.ts`.
- Potentially modify tool handlers (`handle-explore-external-directories.ts`, `handle-read-external-files.ts`) to initiate or participate in the `conversationGraph`.
- Define the `conversationGraph` structure for this specific workflow.
- Create robust evaluation tests (`src/eval/external-project-exploration.test.ts`) covering various scenarios (file paths found, synthesis only, errors, non-existent files requested).

## 6. Open Questions

- How complex should the initial `conversationGraph` be? Start simple and add edge cases?
- How best to handle user interruptions during the graph execution?
