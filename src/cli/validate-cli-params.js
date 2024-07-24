const allowedParameters = [
  '--dry-run',
  '--consider-all-files',
  '--allow-file-create',
  '--allow-file-delete',
  '--allow-directory-create',
  '--allow-file-move',
  '--codegen-only',
  '--game-only',
  '--chat-gpt',
  '--explicit-prompt=',
  '--task-file=',
  '--dependency-tree',
  '--verbose-prompt',
  '--anthropic',
  '--require-explanations'
];

// Validate CLI parameters accordingly to those mentioned in README.md, fail the process if not valid, or unknown parameter is passed
export function validateCliParams() {
  const providedParameters = process.argv.slice(2);

  providedParameters.forEach((param) => {
    if (!param.startsWith('--')) {
      console.error(`Invalid parameter: ${param}, all parameters must start with --`);
      process.exit(1);
    }
    if (!allowedParameters.some((p) => param.startsWith(p))) {
      console.error(`Invalid parameter: ${param}, allowed parameters are: ${allowedParameters.join(', ')}`);
      process.exit(1);
    }
  });
}