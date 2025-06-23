module.exports = {
  testEnvironment: 'node',
  collectCoverageFrom: [
    'routers/**/*.js',
    'socket-handlers/**/*.js',
    '!**/node_modules/**',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  testMatch: ['**/__tests__/**/*.test.js', '**/?(*.)+(spec|test).js'],
  verbose: true,
  testTimeout: 10000,
}; 