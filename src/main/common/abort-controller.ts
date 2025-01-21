export let abortController: AbortController | null = null;

export function setAbortController(controller: AbortController | null) {
  abortController = controller;
}
