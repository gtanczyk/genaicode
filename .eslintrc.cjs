module.exports = {
  root: true,
  env: { node: true },
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  ignorePatterns: ['build', '.eslintrc.cjs'],
  parser: '@typescript-eslint/parser',
};
