module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.js', '**/?(*.)+(spec|test).js'],
  collectCoverage: true,
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'routers/**/*.js',
    'socket-handlers/**/*.js',
    '*.js',
    '!**/node_modules/**',
    '!**/vendor/**',
    '!**/coverage/**',
    '!**/jest.config.js'
  ],
  coverageReporters: ['text', 'lcov', 'clover', 'html'],
  testTimeout: 10000,
  verbose: true
}; 