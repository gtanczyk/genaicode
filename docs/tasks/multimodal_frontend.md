# Multimodal Frontend Implementation Plan (MVP)

This document outlines the plan for implementing multimodal functionality in the GenAIcode web UI, allowing users to include images along with their text prompts for enhanced code generation. This plan focuses on the essential features for a Minimum Viable Product (MVP).

## Overview

The multimodal frontend will enable users to upload images as part of their prompts, enhancing the context provided to the AI for code generation. This feature will be integrated into the existing web UI, focusing on a seamless user experience while minimizing code changes.

## User Journey

1. User opens the GenAIcode web UI.
2. User types their prompt in the input area.
3. User can upload one or multiple images related to their prompt directly in the input area.
4. User submits the prompt along with the attached images.
5. The multimodal prompt (text + images) is processed by the backend.
6. The AI generates code based on both the text and image inputs.
7. The response, including any generated code, is displayed in the chat interface along with the uploaded images.

## Implementation Details

### 1. Input Area (src/main/ui/frontend/app/components/input-area.tsx)

- Add a file input for image uploads, integrated with the existing text input.
- Implement basic client-side validation for file types and sizes.
- Provide visual feedback for successful uploads and errors.

### 2. Chat Interface (src/main/ui/frontend/app/components/chat-interface.tsx)

- Update the message display to show uploaded images alongside the text prompt.
- Implement a simple image viewer for uploaded images.

### 3. API Client (src/main/ui/frontend/app/api/api-client.ts)

- Create a new function to handle sending multimodal prompts (text + images) to the backend.
- Implement basic error handling for image upload failures.

### 4. Backend API (src/main/ui/backend/api.ts)

- Update the API to accept multimodal prompts, including both text and image files.
- Implement basic validation and error handling for incoming requests.

### 5. Backend Service (src/main/ui/backend/service.ts)

- Modify the Service class to process multimodal prompts.
- Implement logic to pass both text and image data to the prompt service.

### 6. Prompt Service (src/prompt/prompt-service.ts)

- Update the promptService function to handle multimodal inputs.
- Modify the logic to include image data in the prompts sent to the AI service.
- Adapt the existing file reading logic to handle in-memory uploaded files instead of files stored in the file system.

### 7. AI Service Integration

- Modify the AI service integration files (in the ai-service/ directory) to accept and process image data along with text prompts.
- Focus on adapting the following services based on their current implementation:
  - Vertex AI (vertex-ai.ts)
  - AI Studio (ai-studio.ts)
  - ChatGPT (chat-gpt.ts)
  - Anthropic (anthropic.ts)
  - Vertex AI Claude (vertex-ai-claude.ts)
- Ensure that the image data is properly formatted and included in the requests to the AI services.

### 8. Types and Interfaces (src/main/codegen-types.ts)

- Update the CodegenOptions interface to include properties for handling multimodal inputs.
- Create new types or interfaces as needed to represent multimodal prompts.

## File Upload Restrictions

- Implement the following restrictions for uploaded images:
  - Maximum file size: 5MB per image
  - Allowed file formats: .jpg, .jpeg, .png, .gif
  - Maximum number of images per prompt: 5

## Security Considerations

- Implement basic server-side validation of file types and sizes to prevent malicious uploads.
- Ensure that uploaded images are processed in-memory and not stored permanently on the server.

## Performance Considerations

- While performance is not a primary concern for the MVP, ensure that the application remains responsive when handling image uploads and processing.

## Conclusion

This implementation plan provides a focused roadmap for adding essential multimodal functionality to the GenAIcode web UI as an MVP. By following this plan and leveraging the existing infrastructure, we will create a working end-to-end solution that allows users to include both text and images in their prompts for AI-assisted code generation. The plan minimizes code changes while adapting the necessary components to handle in-memory file processing and integration with multiple AI services.
