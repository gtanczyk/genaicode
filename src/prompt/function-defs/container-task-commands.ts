import { FunctionDef } from '../../ai-service/common-types.js';
import { rcConfig } from '../../main/config.js';

export const runCommandDef: FunctionDef = {
  name: 'runCommand',
  description: `Execute a shell command in the Docker container.
IMPORTANT: 
- The command will block you until it completes, so consider using a non-blocking approach if needed.
- For complex/long input you should prefer \`stdin\` over command-line arguments. For example instead of echo \`some long text\`, you can put the long text in the \`stdin\` field, and then use it in the command like this: \`cat | some_command\`.
  `,
  parameters: {
    type: 'object',
    properties: {
      reasoning: {
        type: 'string',
        description: 'Explanation of why this command is needed for the task.',
      },
      command: {
        type: 'string',
        description:
          'The shell command to execute in the container. Command must be 256 characters or less. If there is a need for a longer command, consider using a script file, and consider using `stdin` to pass the script contents.',
        maxLength: 256,
      },
      stdin: {
        type: 'string',
        description:
          'Input to provide to the command via stdin. Equivalent of `echo <stdin> | <command>`. Very good for long inputs, better than passing as command-line arguments in the command string parameter.',
      },
      truncMode: {
        type: 'string',
        description: 'Mode for truncating command output (e.g., "start", "end").',
        enum: ['start', 'end'],
      },
      workingDir: {
        type: 'string',
        description: 'Working directory inside the container to run the command in. This MUST be an absolute path.',
        minLength: 1,
      },
    },
    required: ['reasoning', 'command', 'stdin', 'workingDir', 'truncMode'],
  },
};

export const completeTaskDef: FunctionDef = {
  name: 'completeTask',
  description: 'Mark the container task as successfully completed.',
  parameters: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description: 'A brief summary of what was accomplished.',
      },
    },
    required: ['summary'],
  },
};

export const failTaskDef: FunctionDef = {
  name: 'failTask',
  description: 'Mark the container task as failed.',
  parameters: {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        description: 'Explanation of why the task failed.',
      },
    },
    required: ['reason'],
  },
};

export const wrapContextDef: FunctionDef = {
  name: 'wrapContext',
  description: 'Replace prior conversation in the loop with a concise summary for continued processing.',
  parameters: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description: 'A summary of prior steps and important findings to keep for next actions.',
      },
      plan: {
        type: 'string',
        description: 'A concise plan outlining the plan of action for the task.',
      },
      progress: {
        type: 'string',
        description: 'What was achieved so far? What are the outcomes?',
      },
      importantFiles: {
        type: 'array',
        items: {
          type: 'string',
          description: `Paths to important files to keep for next actions.
It is critically IMPORTANT to keep track of files which are essential for the task. For example the files that were modified or created during the task so far.`,
        },
      },
      nextStep: {
        type: 'string',
        description: 'The next step to take in the process.',
      },
    },
    required: ['summary', 'plan', 'progress', 'importantFiles', 'nextStep'],
  },
};

export const setExecutionPlanDef: FunctionDef = {
  name: 'setExecutionPlan',
  description: 'Record a concise execution plan to follow in subsequent steps.',
  parameters: {
    type: 'object',
    properties: {
      plan: {
        type: 'string',
        description: 'Brief execution plan (high level outline).',
      },
    },
    required: ['plan'],
  },
};

export const updateExecutionPlanDef: FunctionDef = {
  name: 'updateExecutionPlan',
  description: 'Update progress/status against the previously set execution plan.',
  parameters: {
    type: 'object',
    properties: {
      progress: {
        type: 'string',
        description: 'Progress update and next steps if applicable.',
      },
    },
    required: ['progress'],
  },
};

export const getCopyToContainerDef: () => FunctionDef = () => ({
  name: 'copyToContainer',
  description: 'Copy a file or directory from the host to the container.',
  parameters: {
    type: 'object',
    properties: {
      hostPath: {
        type: 'string',
        description: `The absolute path of the file or directory on the host machine, which must be within the project root directory.
The file path must start from: ${rcConfig.rootDir}`,
      },
      containerPath: {
        type: 'string',
        description: 'The absolute destination path inside the container.',
      },
    },
    required: ['hostPath', 'containerPath'],
  },
});

export const getCopyFromContainerDef: () => FunctionDef = () => ({
  name: 'copyFromContainer',
  description: 'Copy a file or directory from the container to the host.',
  parameters: {
    type: 'object',
    properties: {
      containerPath: {
        type: 'string',
        description:
          'The absolute destination path on the host machine, which must be within the project root directory.',
      },
      hostPath: {
        type: 'string',
        description: `The absolute destination path on the host machine, which must be within the project root directory.
The file path must start from: ${rcConfig.rootDir}`,
      },
    },
    required: ['containerPath', 'hostPath'],
  },
});

export const sendMessageDef: FunctionDef = {
  name: 'sendMessage',
  description: 'Send a message to the user. Should be used for non-interactive messages.',
  parameters: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: 'The message to send to the user.',
      },
      isQuestion: {
        type: 'boolean',
        description: 'Whether the message is a question, and user input is expected.',
      },
    },
    required: ['message', 'isQuestion'],
  },
};
