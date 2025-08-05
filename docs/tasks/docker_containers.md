# 🐳 Docker Container Execution (with Lite Summarizer) – Design Doc (MVP)

## 1. Problem Statement

GenAIcode cannot currently execute generated code safely. Docker-based isolation and concise summarization of command outputs are needed to minimize costs and token usage.

## 2. Goals (MVP)

- ✅ Execute commands safely in Docker containers using `dockerode`.
- ✅ Three new actions: `startContainer`, `runCommand`, `stopContainer`.

### Out-of-Scope

- ❌ Advanced Docker configs (mounts, env vars).
- ❌ Real-time streaming outputs.
- ❌ Docker image building.

---

## 3. System Overview

```

GenAIcode LLM
│ (via step-ask-question)
▼
GenAIcode Action Dispatcher
│
├─ existing handlers...
└─ 🆕 DockerActionHandler
├─── startContainer()
├─── runCommand() ───► Lite LLM Summarizer
└─── stopContainer()
│
▼
Local Docker Engine (dockerode)

```

- Actions implemented at:
  `src/prompt/steps/step-ask-question/handlers/docker.ts`

---

## 4. Action Interfaces

### ✅ `startContainer`

| Input Args         | Output                 |
| ------------------ | ---------------------- |
| `{ image, name? }` | `{ id, name, status }` |

### ✅ `runCommand` (with summarizer)

| Input Args             | Output                                      |
| ---------------------- | ------------------------------------------- |
| `{ containerId, cmd }` | `{ exitCode, summary, truncated, logPath }` |

### ✅ `stopContainer`

| Input Args        | Output       |
| ----------------- | ------------ |
| `{ containerId }` | `{ status }` |

---

## 5. Implementation Details

### 5.1. `startContainer`

- Instantiate Docker client.
- Pull image (if needed).
- Create and start container:
  ```js
  const docker = new Docker({ socketPath: '/var/run/docker.sock' });
  const container = await docker.createContainer({ Image: image, name });
  await container.start();
  ```

````

- Return container info.

### 5.2. `runCommand`

- Execute command in container (`docker.exec`).
- Capture full output
- Pass capped raw output to Lite LLM summarizer:

  ```js
  exec = await container.exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true });
  stream = await exec.start({ hijack: true });
  const rawOutput = captureWithCap(stream, MAX_BYTES, MAX_LINES);
  const summary = await liteLLMSummarizer(rawOutput);
  ```

- Return summarized output & log path.

### 5.3. `stopContainer`

- Stop and remove container:

  ```js
  await container.stop();
  await container.remove();
  ```

- Return cleanup status.

---

## 6. Token Management & Summarizer

- Raw output caps:

  - `MAX_LINES = 500`
  - `MAX_BYTES = 16 * 1024`

- Lite LLM summarization prompt:

  ```
  Summarize concisely, noting errors, failures, and important results (~200 tokens):

  <rawOutput>
  ```

- Example summarized response:

  ```json
  {
    "exitCode": 0,
    "summary": "Tests passed: 23/23. No errors.",
    "truncated": true,
  }
  ```

---

## 7. System Prompt Changes

```
Docker actions now available:
• startContainer({ image, name? })
• runCommand({ containerId, cmd })
• stopContainer({ containerId })

Note: Command outputs summarized (~200 tokens)
Always stop containers when done, and stop them when genaicode process ends
```

---

## 8. Error Handling

- Return structured errors to LLM:

  ```json
  { "error": "Error message", "code": 500 }
  ```

- Let LLM handle retries or escalate.

---

## 9. Security & Guidelines

- Approved Docker images only.
- Mandatory cleanup (`stopContainer`).
- Disallow dangerous commands.

---

## 10. Implementation Tasks

1. [ ] Add Docker (`dockerode`) and Lite LLM summarizer dependencies.
2. [ ] Define new action schemas/interfaces.
3. [ ] Implement Docker action handler (`docker.ts`).
4. [ ] Implement Lite LLM summarization function.
5. [ ] Add token-capping & log-storage logic.
6. [ ] Update system prompts & documentation.
7. [ ] Implement testing strategies.

---

## 11. Testing & Validation

- Unit tests with mocks (dockerode, summarizer).
- Integration tests (Docker-in-Docker).
- Validate summarization quality.

---

## 12. Risk & Reevaluation

| Risk                          | Level  | Mitigation                  |
| ----------------------------- | ------ | --------------------------- |
| Token cost overrun            | Medium | Output caps & summarizer ✅ |
| Docker leaks                  | Low    | Mandatory cleanup ✅        |
| Summarizer latency            | Medium | Choose lightweight LLM ✅   |
| Security (untrusted commands) | Medium | Allowed commands/images ✅  |

---

## 🎯 Final Recommendation

✅ Proceed with MVP implementation immediately.
✅ Use **Lite LLM summarization** from the start to optimize cost & efficiency.
````
