import type { Config } from 'jest';

const config: Config = {
  clearMocks: true,
  preset: 'ts-jest',
  roots: ['<rootDir>/tests'],
  testEnvironment: 'node',
  moduleDirectories: ['node_modules', '<rootDir>/frontend/node_modules'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/frontend/src/$1'
  },
  collectCoverageFrom: ['src/**/*.ts', 'frontend/src/**/*.{ts,tsx}']
};

export default config;
