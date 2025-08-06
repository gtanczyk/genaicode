# 🐳 Docker Container Task Execution – Design Doc (MVP)

## 1. Problem Statement

GenAIcode cannot currently execute generated code safely. A mechanism to run complex, multi-step tasks within a sandboxed Docker environment is needed. The process should be self-contained, from container creation to task completion and cleanup, and provide a concise summary of the outcome.

## 2. Goals (MVP)

- ✅ Execute multi-step tasks safely in a Docker container using a single, self-contained action.
- ✅ Define a new action: `runContainerTask`.

### Out-of-Scope

- ❌ Advanced Docker configurations (e.g., volume mounts, environment variables).
- ❌ Real-time streaming of command outputs.
- ❌ Building Docker images.

---

## 3. System Overview

```
GenAIcode LLM
│ (via step-ask-question)
▼
GenAIcode Action Dispatcher
│
├─ existing handlers...
└─ 🆕 RunContainerTask Executor
   │
   ├─ 1. Start Container
   ├─ 2. Command Execution Loop (with internal LLM for next command)
   ├─ 3. Stop & Remove Container
   └─ 4. Summarize Result
   │
   ▼
   Local Docker Engine (via dockerode)
```

- The new action handler will be implemented as a new ask question action type.

---

## 4. Action Interface

### ✅ `runContainerTask`

| Input Args                   | Output                 |
| ---------------------------- | ---------------------- |
| `{ image, taskDescription }` | `{ success, summary }` |

- **`image`**: The Docker image to use (e.g., `ubuntu:latest`).
- **`taskDescription`**: A detailed, natural language description of the entire task to be performed. This guides the internal command execution loop.
- **`success`**: A boolean indicating if the overall task was completed successfully.
- **`summary`**: A concise, AI-generated summary of the task's outcome, including key results and errors.

---

## 5. Implementation Details

The `runContainerTask` executor will be a self-contained ask question action handler that performs the following steps:

### 5.1. Container Lifecycle Management

1.  **Instantiate Docker Client**: Connect to the local Docker daemon using `dockerode`.
2.  **Pull Image**: Ensure the specified `image` is available locally, pulling it if necessary.
3.  **Create and Start Container**:
    ```javascript
    const docker = new Docker({ socketPath: '/var/run/docker.sock' });
    const container = await docker.createContainer({
      Image: image,
      Tty: true, // Keep container running
      Cmd: ['/bin/sh'], // Start a shell
    });
    await container.start();
    ```
4.  **Cleanup**: After the task is finished (or on error), the executor will stop and remove the container.
    ```javascript
    await container.stop();
    await container.remove();
    ```

### 5.2. Command Execution Loop

This is the core of the executor. It will use an internal LLM call to decide the sequence of commands to run based on the `taskDescription`.

1.  **Initialize State**: Start with the initial `taskDescription` and an empty command history.
2.  **Loop**:
    a. **Get Next Command**: Make an internal `generateContent` call to a cheap model (e.g., Gemini Flash).

    - **Prompt**:

      ````
      You are an expert system operator inside a Docker container.
      Based on the overall task and the history of commands executed so far, determine the single next shell command to run.
      If the task is complete, respond with "TASK_COMPLETE".
      If you cannot determine the next step, respond with "TASK_FAILED".

           Overall Task:
           ${taskDescription}

           Command History (stdout/stderr):
           ${commandHistory}

           Next command:
           ```

      b. **Execute Command**: Run the generated command in the container using `docker.exec`.
      c. **Capture & Log Output**: Capture `stdout` and `stderr`, cap it to prevent excessive length, and append it to the session log and the `commandHistory`.
      d. **Check for Completion**: If the model returns `TASK_COMPLETE` or `TASK_FAILED`, exit the loop.
      ````

3.  **Task Finalization**: Once the loop terminates, the executor proceeds to the final summarization step.

---

## 6. Token Management & Summarization

- **Internal Loop**: The command generation loop will use a cheap, fast model to minimize latency and cost. The context for this internal LLM will be the task description and the history of command outputs.
- **Final Summary**: After the loop completes, a more capable model will be used to generate the final `summary` for the user.

  - **Prompt**:

    ```
    Based on the following task description and the full command log, provide a concise summary of the outcome.
    Highlight key results, successes, and any errors encountered.

    Task Description:
    ${taskDescription}

    Full Command Log:
    ${fullLog}

    Summary:
    ```

---

## 7. System Prompt Changes

The system prompt will be updated to inform the primary LLM about the new capability:

```
A new action is available for running complex tasks in an isolated environment:
• runContainerTask({ image, taskDescription })

Use this to execute multi-step command-line tasks. Provide a clear, step-by-step natural language description in `taskDescription`.
The action will handle starting the container, executing commands until the task is done, and cleaning up.
Example: "runContainerTask({ image: 'node:18', taskDescription: 'Clone the repository from https://github.com/example/project.git, run npm install, and then execute the test suite with npm test.' })"
```

---

## 8. Error Handling

- **Execution Errors**: If any shell command returns a non-zero exit code, the error will be logged and included in the context for the next command-generation step. The internal LLM can decide whether to continue or abort.
- **Container Errors**: Errors during container creation, start, or stop will cause the entire process to fail, returning a structured error message.
- **Loop Errors**: If the internal LLM returns `TASK_FAILED`, the loop terminates, and the task is marked as unsuccessful.

---

## 9. Security & Guidelines

- **Image Whitelist**: For added security, a configurable list of approved Docker images can be implemented.
- **Command Sanitization**: Input sanitization on the `taskDescription` is not the primary defense; the sandboxing is. However, monitoring for obviously malicious intent is a good practice.
- **Resource Limits**: The container should be run with resource constraints (CPU, memory) in a future iteration to prevent abuse.

---

## 11. Testing & Validation

- **Unit Tests**: Mock `dockerode` to simulate container and exec behavior. Mock `generateContent` for the internal loop to test a predefined sequence of commands (e.g., success path, error path).
- **Integration Tests**: Use Docker-in-Docker or a local Docker daemon to run a simple, real-world task (e.g., `git clone` and `ls`).
- **Validation**: Manually validate that for a given `taskDescription`, the generated commands are logical and the final summary is accurate.

---

## 12. Risk & Reevaluation

| Risk                        | Level  | Mitigation                                                              |
| --------------------------- | ------ | ----------------------------------------------------------------------- |
| Token cost (internal loop)  | Medium | Use a cheap, fast model (e.g., Gemini Flash) for command generation. ✅ |
| Infinite command loop       | Medium | Implement a max-command limit (e.g., 25 commands) as a safeguard.       |
| Security (untrusted images) | High   | Implement a configurable image whitelist. (Post-MVP)                    |
| Summarizer quality/accuracy | Low    | The user has access to the full log file for details.                   |

---

## 🎯 Final Recommendation

✅ Proceed with the MVP implementation of the `runContainerTask` action. It simplifies the user interaction and provides a more powerful, self-contained execution environment.
