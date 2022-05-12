module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true,
    },
  },
  settings: {
    react: {
      version: 'detect',
    },
  },
  extends: [
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
  ],
  rules: {
    'no-console': 'warn',
    'import/no-extraneous-dependencies': 'off',
    'no-undef': 'warn',
    'no-restricted-globals': 'warn',
    'prefer-const': 'warn',
    'no-magic-numbers': 'warn',
  },
  env: {
    jest: true,
  },
};
