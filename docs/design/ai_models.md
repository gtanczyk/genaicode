# AI Models in GenAIcode Tool

The GenAIcode tool supports multiple AI models to provide flexibility and optimize performance for different types of code generation tasks. This document outlines the supported models and their characteristics.

## Vertex AI

- **Model**: Google's Vertex AI with Gemini Pro model
- **Usage**: Default model for the tool
- **Features**:
  - High-quality code generation
  - Optimized for various programming tasks
  - Safety settings can be disabled with `--gemini-block-none` flag (requires whitelisted Cloud project)
- **Best for**: General-purpose code generation tasks

## Claude via Vertex AI

- **Activation**: Use `--vertex-ai-claude` flag
- **Features**:
  - Combines Claude's capabilities with Vertex AI infrastructure
  - Requires setting both `GOOGLE_CLOUD_PROJECT` and `GOOGLE_CLOUD_REGION` environment variables
- **Best for**: Projects already using Google Cloud infrastructure but wanting Claude's capabilities

## Model Comparison

| Feature         | Vertex AI (Gemini Pro) | Claude via Vertex AI |
| --------------- | ---------------------- | -------------------- |
| Default         | Yes                    | No                   |
| Activation Flag | None needed            | `--vertex-ai-claude` |
| Specialization  | General-purpose        | Hybrid               |
| Infrastructure  | Google Cloud           | Google Cloud         |

## Token Usage and Cost Estimation

The tool provides feedback on token usage and estimated cost for each AI model:

- **Vertex AI**: Input and output characters are counted and priced separately.
- **Claude via Vertex AI**: Input and output tokens are counted and priced based on Vertex AI pricing.

This information is displayed at the end of each code generation process, helping users understand the resource usage and associated costs.

## Choosing the Right Model

The choice of AI model depends on various factors:

1. **Project Requirements**: Consider the specific needs of your project, such as code complexity or language diversity.
2. **Infrastructure Compatibility**: If you're already using Google Cloud, choosing a compatible model might be beneficial.
3. **Cost Considerations**: Different models have different pricing structures. Consider your budget and expected usage.
4. **Performance**: Some models might perform better for specific types of code generation tasks.

By offering multiple AI model options, GenAIcode ensures that developers can choose the most appropriate tool for their specific code generation needs, balancing factors like performance, cost, and project requirements.
