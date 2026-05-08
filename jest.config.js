module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  // CosmJS 0.38+ pulls in ESM deps (e.g. @scure/*) and ships some TS sources.
  // Jest ignores node_modules by default, so we must explicitly allow-transform
  // the packages we import/execute in tests.
  transformIgnorePatterns: [
    '/node_modules/(?!(@nolus/nolusjs|@cosmjs|@scure|@noble)/)',
  ],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
    '^.+\\.jsx?$': 'babel-jest',
  },
  testTimeout: 2000000,
  setupFiles: ['dotenv/config'],
  verbose: true,
};
