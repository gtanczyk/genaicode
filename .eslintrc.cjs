module.exports = {
  root: true,
  env: { node: true },
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  ignorePatterns: ['build', '.eslintrc.cjs', 'examples/**/*', 'dist'],
  parser: '@typescript-eslint/parser',
};
