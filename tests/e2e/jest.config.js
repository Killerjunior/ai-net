const path = require('path');

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: path.resolve(__dirname, '../../'),
  roots: ['<rootDir>/tests/e2e'],
  testMatch: ['<rootDir>/tests/e2e/**/*.test.ts'],
  moduleDirectories: ['node_modules', '<rootDir>/backend/node_modules', '<rootDir>/smart-contracts/node_modules'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1'
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        strict: true,
        esModuleInterop: true,
        target: 'ES2020',
        module: 'commonjs',
        resolveJsonModule: true,
      },
    }],
  },
  setupFilesAfterEnv: ['<rootDir>/tests/e2e/setup.ts'],
  globalTeardown: '<rootDir>/tests/e2e/teardown.ts',
  testTimeout: 30000
};
