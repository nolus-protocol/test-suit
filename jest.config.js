module.exports = {
  verbose: true,
  testEnvironment: 'node',
  preset: 'ts-jest',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  transformIgnorePatterns: [
    '/node_modules/(?!@nolus/nolusjs|@cosmjs|@scure|@noble)',
  ],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
    '^.+\\.jsx?$': 'babel-jest',
  },
  setupFiles: ['<rootDir>/src/setup.ts'],
  testTimeout: 2000000,
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/src/manually/',
    '<rootDir>/src/preflight/',
  ],
};
