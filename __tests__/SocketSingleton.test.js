/**
 * Tests for SocketSingleton.js
 */

// Mock socket.io
jest.mock('socket.io', () => {
  return jest.fn().mockImplementation(() => {
    return {
      on: jest.fn(),
      emit: jest.fn(),
    };
  });
});

describe('SocketSingleton Tests', () => {
  beforeEach(() => {
    // Clear the require cache to reset the singleton between tests
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('should be a singleton', () => {
    // Arrange & Act
    const socketSingleton1 = require('../SocketSingleton');
    const socketSingleton2 = require('../SocketSingleton');

    // Assert
    expect(socketSingleton1).toBe(socketSingleton2);
  });

  test('should initialize Socket.io when setup is called', () => {
    // Arrange
    const socketSingleton = require('../SocketSingleton');
    const mockServer = {}; // Mock HTTP server

    // Act
    const io = socketSingleton.setup(mockServer);

    // Assert
    expect(io).toBeDefined();
    expect(require('socket.io')).toHaveBeenCalledWith(
      mockServer,
      expect.any(Object)
    );
  });

  test('should return existing io instance if already initialized', () => {
    // Arrange
    const socketSingleton = require('../SocketSingleton');
    const mockServer = {}; // Mock HTTP server

    // First initialization
    const io1 = socketSingleton.setup(mockServer);

    // Socket.io should be called only once
    const socketIoMock = require('socket.io');
    socketIoMock.mockClear();

    // Act - Call setup again
    const io2 = socketSingleton.setup(mockServer);

    // Assert
    expect(io1).toBe(io2);
    expect(socketIoMock).not.toHaveBeenCalled();
  });

  test('should throw error when getIO is called before setup', () => {
    // Arrange
    jest.resetModules();
    const socketSingleton = require('../SocketSingleton');

    // Act & Assert
    expect(() => {
      socketSingleton.getIO();
    }).toThrow('Socket.io not initialized. Call setup() first.');
  });

  test('should return io instance when getIO is called after setup', () => {
    // Arrange
    const socketSingleton = require('../SocketSingleton');
    const mockServer = {}; // Mock HTTP server
    const io = socketSingleton.setup(mockServer);

    // Act
    const result = socketSingleton.getIO();

    // Assert
    expect(result).toBe(io);
  });
});
