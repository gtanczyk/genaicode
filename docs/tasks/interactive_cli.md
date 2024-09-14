We are adding a new mode to genaicode: --interactive

This option transforms how the app works. In this mode the app should prompt the user for things the user would provide with cli options in non interactive mode.

I think the interactive mode should work in the following cycle:

0. Say hello to the user, display basic intro line about Genaicode, including version number
1. Start: ask user what to do:
   - process @CODEGEN comments (if detected)
   - text prompt (simple input from inquirer)
   - task file (use inquirer-file-selector to let the user select a file)
   - exit
2. Let the user configure options (allow file create, allow file delete etc.)
3. Execute the codegen
4. Go back to point 1.

We will be using the @inquirer/prompts module to implement the interactive mode.

As for the implementation we probably need to create a new file in main/, and modify codegen.ts to use it if --interactive is enabled.
