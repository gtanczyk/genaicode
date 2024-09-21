/**
 * Function definition for patchFile
 */
export const patchFile = {
  name: 'patchFile',
  description:
    'Partially update a file content. The file must already exists in the application source code. The function should be called only if there is a need to actually change something.',
  parameters: {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: 'The file path to patch.',
      },
      explanation: {
        type: 'string',
        description: 'The explanation of the reasoning behind the suggested code changes for this file',
      },
      patch: {
        type: 'string',
        description: `Modification to the file expressed in patch format. Example patch:

\`\`\`
Index: filename.js
===================================================================
--- filename.js
+++ filename.js
@@ -1,2 +1,3 @@
 line1
+line3
 line2
\\ No newline at end of file
\`\`\`
          `,
      },
    },
    required: ['filePath', 'patch'],
  },
} as const;
