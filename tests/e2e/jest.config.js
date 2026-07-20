const path = require('path');

module.exports = {
  testEnvironment: 'node',
  rootDir: path.resolve(__dirname, '../../'),
  testMatch: ['<rootDir>/tests/e2e/**/*.test.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1'
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }]
  },
  setupFilesAfterEnv: ['<rootDir>/tests/e2e/setup.ts'],
  globalTeardown: '<rootDir>/tests/e2e/teardown.ts',
  collectCoverageFrom: [
    'backend/src/**/*.ts',
    'smart-contracts/src/**/*.ts',
    '!**/*.d.ts'
  ],
  coverageDirectory: '<rootDir>/coverage-e2e',
  testTimeout: 30000
};
