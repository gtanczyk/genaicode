import { startContainerDef } from '../../operations/docker/start-container-def.js';
import { runCommandDef } from '../../operations/docker/run-command-def.js';
import { stopContainerDef } from '../../operations/docker/stop-container-def.js';

/**
 * Function definition for the 'startContainer' action, intended for the LLM.
 */
export const startContainer = startContainerDef;

/**
 * Function definition for the 'runCommand' action, intended for the LLM.
 */
export const runCommand = runCommandDef;

/**
 * Function definition for the 'stopContainer' action, intended for the LLM.
 */
export const stopContainer = stopContainerDef;
