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

## OpenAI GPT

- **Activation**: Use `--chat-gpt` flag
- **Features**:
  - Versatile performance across various coding tasks
  - Strong language understanding and generation capabilities
- **Best for**: Projects requiring diverse coding styles or languages

## Anthropic Claude

- **Activation**: Use `--anthropic` flag
- **Features**:
  - Designed to be helpful, harmless, and honest
  - Strong focus on safety and reliability
- **Best for**: Code generation tasks requiring high reliability and safety standards

## Claude via Vertex AI

- **Activation**: Use `--vertex-ai-claude` flag
- **Features**:
  - Combines Claude's capabilities with Vertex AI infrastructure
  - Requires setting both `GOOGLE_CLOUD_PROJECT` and `GOOGLE_CLOUD_REGION` environment variables
- **Best for**: Projects already using Google Cloud infrastructure but wanting Claude's capabilities

## Model Comparison

| Feature             | Vertex AI (Gemini Pro)     | OpenAI GPT   | Anthropic Claude | Claude via Vertex AI |
| ------------------- | -------------------------- | ------------ | ---------------- | -------------------- |
| Default             | Yes                        | No           | No               | No                   |
| Activation Flag     | None needed                | `--chat-gpt` | `--anthropic`    | `--vertex-ai-claude` |
| Specialization      | General-purpose            | Versatile    | Safety-focused   | Hybrid               |
| Infrastructure      | Google Cloud               | OpenAI       | Anthropic        | Google Cloud         |
| Vision Capabilities | Yes (with `--vision` flag) | Limited      | Limited          | Limited              |

## Token Usage and Cost Estimation

The tool provides feedback on token usage and estimated cost for each AI model:

- **Vertex AI**: Input and output characters are counted and priced separately.
- **OpenAI GPT**: Input and output tokens are counted and priced separately.
- **Anthropic Claude**: Input and output tokens are counted and priced separately.
- **Claude via Vertex AI**: Input and output tokens are counted and priced based on Vertex AI pricing.

This information is displayed at the end of each code generation process, helping users understand the resource usage and associated costs.

## Choosing the Right Model

The choice of AI model depends on various factors:

1. **Project Requirements**: Consider the specific needs of your project, such as code complexity, language diversity, or safety concerns.
2. **Infrastructure Compatibility**: If you're already using a specific cloud provider, choosing a compatible model might be beneficial.
3. **Cost Considerations**: Different models have different pricing structures. Consider your budget and expected usage.
4. **Performance**: Some models might perform better for specific types of code generation tasks.
5. **Safety and Reliability**: If your project has strict safety requirements, models like Claude might be more suitable.

By offering multiple AI model options, GenAIcode ensures that developers can choose the most appropriate tool for their specific code generation needs, balancing factors like performance, cost, and project requirements.
