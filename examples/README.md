# Examples

Examples of applications generated entirely with `npx genaicode`:

- [Python Hello World App](./python_hello_world) example demonstrates usage of `--task-file` feature:

  - first command:
    ```bash
    npx genaicode --task-file="tasks/create_python_hw_app_task.md"
    ```
  - second command:
    ```bash
    npx genaicode --task-file="tasks/use_virtualenv.md"
    ```

- [Golang Hello World App](./golang_hello_world/) was generated using the `--explicit-prompt` option:

  - first command:
    ```bash
    npx genaicode --explicit-prompt="Create an example hello world application using golang, including README with instructions how to compile it and run it" --allow-file-create
    ```
  - second command:
    ```bash
    npx genaicode --explicit-prompt="I want the Hello, World! text to be colored"
    ```

- [Java Hello World App](./java_hello_world/):

  ```bash
  npx genaicode --explicit-prompt="similar to golang_hello_world, and python_hello_world, create an example java hello world application" --allow-file-create --allow-directory-create
  ```

- [Arcanoid Game](./arcanoid_game/):

  - first iteration:

  ```bash
  npx genaicode --vertex-ai-claude --explicit-prompt="Please create a simple arcanoid game" --allow-file-create --allow-directory-create
  ```

  - result: ![first iteration](./arcanoid_game/arcanoid_first_iteration.gif 'first iteration')

  - second iteration: Replace window.alert with html based messages

  ```bash
  npx genaicode --vertex-ai-claude --explicit-prompt="Instead of using window.alert to show messages, show them using HTML, and pause the game when a message is shown. Allow user to confirm the message to continue"
  ```

  - result: ![second iteration](./arcanoid_game/arcanoid_second_iteration.gif 'second iteration')
