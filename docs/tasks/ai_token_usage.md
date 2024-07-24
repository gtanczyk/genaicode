# Summary

Measurement and protection for token usage

# Description

Whenever using codegen with either Vertex AI, or Chat GPT, I want to be informed about token usage. The message should be displayed at the end.
Also estimate the cost of running the prompt.

## Implementation hints

- for vertex ai you should use candidatesTokenCount, promptTokenCount, and totalTokenCount values from UsageMetadata
- for chat gpt you can get similar values from usage object: completion_tokens, prompt_tokens, total_tokens

Print this information together with estimated cost.

As for the code changes it would good to have the cost calculation extracted to a separate function.

## Pricing information

Pricing for Chat GPT models:

- gpt-4o: US$5.00 / 1M input tokens, US$15.00 / 1M output tokens
- gpt-3.5-turbo-0125: US$0.50 / 1M input tokens, US$1.50 / 1M output tokens

Pricing for Vertex AI models:

- gemini-1.5-flash-001: input $0.000125 / 1k characters, output $0.000375 / 1k characters
- gemini-1.5-pro: input $0.000125 / 1k characters, output $0.00375 / 1k characters
