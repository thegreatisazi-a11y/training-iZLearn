/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    '^@izlearn/shared$': '<rootDir>/../shared/schemas/index.ts',
    '^@izlearn/shared/(.*)$': '<rootDir>/../shared/schemas/$1',
  },
  setupFilesAfterEnv: [],
  testTimeout: 30000,
};
