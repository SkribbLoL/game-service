/**
 * Comprehensive tests for SocketSingleton.js
 * Covers singleton pattern, initialization, namespace handling, and error scenarios
 */

// Mock socket.io before requiring SocketSingleton
jest.mock('socket.io', () => {
  const mockEmit = jest.fn();
  const mockTo = jest.fn().mockReturnValue({ emit: mockEmit });
  const mockIn = jest.fn().mockReturnValue({ 
    allSockets: jest.fn().mockResolvedValue(new Set(['socket1', 'socket2']))
  });
  
  const mockNamespace = {
    on: jest.fn(),
    to: mockTo,
    emit: mockEmit,
    in: mockIn,
    allSockets: jest.fn().mockResolvedValue(new Set(['socket1', 'socket2'])),
  };

  const mockIo = {
    on: jest.fn(),
    to: mockTo,
    emit: mockEmit,
    in: mockIn,
    allSockets: jest.fn().mockResolvedValue(new Set(['socket1', 'socket2'])),
    of: jest.fn().mockReturnValue(mockNamespace),
  };

  // Store references for test access
  mockIo._mockNamespace = mockNamespace;
  mockIo._mockTo = mockTo;
  mockIo._mockEmit = mockEmit;
  mockIo._mockIn = mockIn;

  return jest.fn(() => mockIo);
});

const socketIO = require('socket.io');

describe('SocketSingleton - Comprehensive Tests', () => {
  let SocketSingleton;
  let mockServer;
  let mockIo;
  let mockNamespace;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Clear the module cache to get a fresh instance
    delete require.cache[require.resolve('../SocketSingleton')];
    
    // Create new instance
    SocketSingleton = require('../SocketSingleton');

    // Create mock server
    mockServer = {
      listen: jest.fn(),
      on: jest.fn(),
    };

    // Get the latest mock instance
    const latestMockIo = socketIO.mock.results[socketIO.mock.results.length - 1]?.value;
    if (latestMockIo) {
      mockIo = latestMockIo;
      mockNamespace = mockIo._mockNamespace;
    }
  });

  describe('Singleton Pattern', () => {
    it('should return the same instance when required multiple times', () => {
      const instance1 = require('../SocketSingleton');
      const instance2 = require('../SocketSingleton');

      expect(instance1).toBe(instance2);
      expect(instance1).toBe(SocketSingleton);
    });

    it('should have singleton properties', () => {
      expect(SocketSingleton).toBeDefined();
      expect(typeof SocketSingleton.setup).toBe('function');
      expect(typeof SocketSingleton.getIO).toBe('function');
      expect(typeof SocketSingleton.emitToRoom).toBe('function');
      expect(typeof SocketSingleton.getSocketsInRoom).toBe('function');
    });

    it('should maintain state across multiple require calls', () => {
      SocketSingleton.setup(mockServer);
      
      const anotherInstance = require('../SocketSingleton');
      
      expect(anotherInstance.io).toBe(SocketSingleton.io);
    });
  });

  describe('setup method', () => {
    it('should initialize Socket.io with server and namespace', () => {
      const result = SocketSingleton.setup(mockServer);

      expect(socketIO).toHaveBeenCalledWith(mockServer, expect.objectContaining({
        transports: ['polling', 'websocket'],
        allowUpgrades: true,
        cors: expect.objectContaining({
          origin: '*',
          methods: ['GET', 'POST'],
          credentials: false,
        }),
        path: '/game/socket.io/',
        pingTimeout: 60000,
        pingInterval: 25000,
        allowEIO3: true,
        maxHttpBufferSize: 1e6,
      }));

      expect(mockIo.of).toHaveBeenCalledWith('/game');
      expect(result).toBe(mockNamespace);
      expect(SocketSingleton.io).toBe(mockNamespace);
    });

    it('should return existing instance if already initialized', () => {
      // First setup
      const firstResult = SocketSingleton.setup(mockServer);
      
      // Reset mock calls
      jest.clearAllMocks();
      
      // Second setup
      const secondResult = SocketSingleton.setup(mockServer);

      expect(socketIO).not.toHaveBeenCalled();
      expect(firstResult).toBe(secondResult);
    });

    it('should setup connection event handlers', () => {
      SocketSingleton.setup(mockServer);

      expect(mockNamespace.on).toHaveBeenCalledWith('connection', expect.any(Function));
    });

    it('should handle socket connection events', () => {
      SocketSingleton.setup(mockServer);

      // Get the connection handler
      const connectionHandler = mockNamespace.on.mock.calls.find(call => call[0] === 'connection')[1];
      
      // Mock socket
      const mockSocket = {
        id: 'test-socket-id',
        on: jest.fn(),
        emit: jest.fn(),
      };

      // Call the connection handler
      connectionHandler(mockSocket);

      expect(mockSocket.on).toHaveBeenCalledWith('disconnect', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockSocket.emit).toHaveBeenCalledWith('welcome', {
        message: 'Connected to game namespace',
      });
    });

    it('should handle socket disconnect events', () => {
      SocketSingleton.setup(mockServer);

      const connectionHandler = mockNamespace.on.mock.calls.find(call => call[0] === 'connection')[1];
      const mockSocket = {
        id: 'test-socket-id',
        on: jest.fn(),
        emit: jest.fn(),
      };

      connectionHandler(mockSocket);

      // Get the disconnect handler
      const disconnectHandler = mockSocket.on.mock.calls.find(call => call[0] === 'disconnect')[1];
      
      // Mock console.log to verify logging
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      disconnectHandler('client disconnect');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Game socket disconnected: test-socket-id, reason: client disconnect')
      );

      consoleSpy.mockRestore();
    });

    it('should handle socket error events', () => {
      SocketSingleton.setup(mockServer);

      const connectionHandler = mockNamespace.on.mock.calls.find(call => call[0] === 'connection')[1];
      const mockSocket = {
        id: 'test-socket-id',
        on: jest.fn(),
        emit: jest.fn(),
      };

      connectionHandler(mockSocket);

      // Get the error handler
      const errorHandler = mockSocket.on.mock.calls.find(call => call[0] === 'error')[1];
      
      // Mock console.error to verify logging
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const testError = new Error('Socket error');
      errorHandler(testError);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Game socket error: test-socket-id'),
        testError
      );

      consoleSpy.mockRestore();
    });

    it('should setup with custom configuration options', () => {
      SocketSingleton.setup(mockServer);

      expect(socketIO).toHaveBeenCalledWith(mockServer, expect.objectContaining({
        transports: ['polling', 'websocket'],
        allowUpgrades: true,
        cors: {
          origin: '*',
          methods: ['GET', 'POST'],
          credentials: false,
        },
        path: '/game/socket.io/',
        pingTimeout: 60000,
        pingInterval: 25000,
        allowEIO3: true,
        maxHttpBufferSize: 1e6,
      }));
    });
  });

  describe('getIO method', () => {
    it('should return the io instance after setup', () => {
      SocketSingleton.setup(mockServer);

      const result = SocketSingleton.getIO();

      expect(result).toBe(mockNamespace);
    });

    it('should throw error if not initialized', () => {
      expect(() => SocketSingleton.getIO()).toThrow(
        'Game Socket.io not initialized. Call setup() first.'
      );
    });

    it('should return same instance on multiple calls', () => {
      SocketSingleton.setup(mockServer);

      const result1 = SocketSingleton.getIO();
      const result2 = SocketSingleton.getIO();

      expect(result1).toBe(result2);
      expect(result1).toBe(mockNamespace);
    });
  });

  describe('emitToRoom method', () => {
    beforeEach(() => {
      SocketSingleton.setup(mockServer);
    });

    it('should emit event to specific room', () => {
      const roomCode = 'ABCDEF';
      const event = 'test-event';
      const data = { message: 'test data' };

      SocketSingleton.emitToRoom(roomCode, event, data);

      expect(mockNamespace.to).toHaveBeenCalledWith(roomCode);
      expect(mockIo._mockEmit).toHaveBeenCalledWith(event, data);
    });

    it('should handle different event types', () => {
      const testCases = [
        { roomCode: 'ROOM1', event: 'game-started', data: { gameId: 123 } },
        { roomCode: 'ROOM2', event: 'user-joined', data: { userId: 'user123' } },
        { roomCode: 'ROOM3', event: 'draw-update', data: { x: 100, y: 200 } },
      ];

      testCases.forEach(({ roomCode, event, data }) => {
        SocketSingleton.emitToRoom(roomCode, event, data);
      });

      expect(mockNamespace.to).toHaveBeenCalledTimes(3);
      expect(mockIo._mockEmit).toHaveBeenCalledTimes(3);
    });

    it('should handle null data gracefully', () => {
      SocketSingleton.emitToRoom('ROOM1', 'test-event', null);

      expect(mockNamespace.to).toHaveBeenCalledWith('ROOM1');
      expect(mockIo._mockEmit).toHaveBeenCalledWith('test-event', null);
    });

    it('should handle undefined data gracefully', () => {
      SocketSingleton.emitToRoom('ROOM1', 'test-event', undefined);

      expect(mockNamespace.to).toHaveBeenCalledWith('ROOM1');
      expect(mockIo._mockEmit).toHaveBeenCalledWith('test-event', undefined);
    });

    it('should handle complex data objects', () => {
      const complexData = {
        users: [
          { id: 'user1', nickname: 'Player1', score: 100 },
          { id: 'user2', nickname: 'Player2', score: 50 },
        ],
        gameState: {
          round: 1,
          currentDrawer: 'user1',
          timeLeft: 60,
        },
        metadata: {
          timestamp: Date.now(),
          version: '1.0.0',
        },
      };

      SocketSingleton.emitToRoom('COMPLEX-ROOM', 'complex-event', complexData);

      expect(mockIo._mockEmit).toHaveBeenCalledWith('complex-event', complexData);
    });

    it('should do nothing if io is not initialized', () => {
      // Reset to uninitialized state
      delete require.cache[require.resolve('../SocketSingleton')];
      const freshInstance = require('../SocketSingleton');

      // Should not throw error
      expect(() => {
        freshInstance.emitToRoom('ROOM1', 'test-event', { data: 'test' });
      }).not.toThrow();
    });
  });

  describe('getSocketsInRoom method', () => {
    beforeEach(() => {
      SocketSingleton.setup(mockServer);
    });

    it('should return sockets in specific room', async () => {
      const roomCode = 'ABCDEF';
      const expectedSockets = new Set(['socket1', 'socket2', 'socket3']);
      
      // Setup the mock for this specific call
      const mockAllSockets = jest.fn().mockResolvedValue(expectedSockets);
      mockNamespace.in.mockReturnValue({ allSockets: mockAllSockets });

      const result = await SocketSingleton.getSocketsInRoom(roomCode);

      expect(mockNamespace.in).toHaveBeenCalledWith(roomCode);
      expect(mockAllSockets).toHaveBeenCalled();
      expect(result).toBe(expectedSockets);
    });

    it('should handle empty rooms', async () => {
      const roomCode = 'EMPTY-ROOM';
      const emptySet = new Set();
      
      const mockAllSockets = jest.fn().mockResolvedValue(emptySet);
      mockNamespace.in.mockReturnValue({ allSockets: mockAllSockets });

      const result = await SocketSingleton.getSocketsInRoom(roomCode);

      expect(result).toEqual(emptySet);
      expect(result.size).toBe(0);
    });

    it('should handle different room codes', async () => {
      const rooms = ['ROOM1', 'ROOM2', 'ROOM3'];
      
      const mockAllSockets = jest.fn().mockResolvedValue(new Set(['socket1']));
      mockNamespace.in.mockReturnValue({ allSockets: mockAllSockets });
      
      for (const room of rooms) {
        await SocketSingleton.getSocketsInRoom(room);
      }

      expect(mockNamespace.in).toHaveBeenCalledTimes(3);
      expect(mockAllSockets).toHaveBeenCalledTimes(3);
    });

    it('should return empty set if io is not initialized', async () => {
      // Reset to uninitialized state
      delete require.cache[require.resolve('../SocketSingleton')];
      const freshInstance = require('../SocketSingleton');

      const result = await freshInstance.getSocketsInRoom('ROOM1');

      expect(result).toEqual(new Set());
    });

    it('should handle errors from allSockets method', async () => {
      const mockAllSockets = jest.fn().mockRejectedValue(new Error('Socket error'));
      mockNamespace.in.mockReturnValue({ allSockets: mockAllSockets });

      await expect(SocketSingleton.getSocketsInRoom('ROOM1')).rejects.toThrow('Socket error');
    });
  });

  describe('Configuration and Edge Cases', () => {
    it('should handle server errors during setup', () => {
      const errorServer = null;

      expect(() => SocketSingleton.setup(errorServer)).not.toThrow();
      expect(socketIO).toHaveBeenCalledWith(errorServer, expect.any(Object));
    });

    it('should handle namespace creation errors', () => {
      // Mock io.of to throw an error
      const errorMockIo = {
        of: jest.fn(() => {
          throw new Error('Namespace creation failed');
        })
      };
      socketIO.mockReturnValueOnce(errorMockIo);

      expect(() => SocketSingleton.setup(mockServer)).toThrow('Namespace creation failed');
    });

    it('should maintain configuration after restart', () => {
      SocketSingleton.setup(mockServer);
      
      // Verify configuration was applied
      expect(socketIO).toHaveBeenCalledWith(mockServer, expect.objectContaining({
        transports: ['polling', 'websocket'],
        allowUpgrades: true,
        path: '/game/socket.io/',
      }));
    });

    it('should handle multiple namespace operations', () => {
      SocketSingleton.setup(mockServer);

      // Perform multiple operations
      SocketSingleton.emitToRoom('ROOM1', 'event1', { data: 1 });
      SocketSingleton.emitToRoom('ROOM2', 'event2', { data: 2 });
      SocketSingleton.getSocketsInRoom('ROOM1');

      expect(mockNamespace.to).toHaveBeenCalledTimes(2);
      expect(mockNamespace.in).toHaveBeenCalledTimes(1);
    });
  });

  describe('Performance and Memory', () => {
    it('should reuse same instance across many operations', () => {
      SocketSingleton.setup(mockServer);

      // Perform many operations
      for (let i = 0; i < 100; i++) {
        SocketSingleton.emitToRoom(`ROOM${i}`, 'event', { index: i });
      }

      // Should still be using the same instance
      expect(SocketSingleton.getIO()).toBe(mockNamespace);
    });

    it('should handle rapid successive operations', () => {
      SocketSingleton.setup(mockServer);

      const operations = Array.from({ length: 50 }, (_, i) => () => {
        SocketSingleton.emitToRoom(`ROOM${i}`, `event${i}`, { data: i });
      });

      // Execute all operations
      operations.forEach(op => op());

      expect(mockNamespace.to).toHaveBeenCalledTimes(50);
      expect(mockIo._mockEmit).toHaveBeenCalledTimes(50);
    });

    it('should handle concurrent getSocketsInRoom calls', async () => {
      SocketSingleton.setup(mockServer);

      const mockAllSockets = jest.fn().mockResolvedValue(new Set(['socket1']));
      mockNamespace.in.mockReturnValue({ allSockets: mockAllSockets });

      const promises = Array.from({ length: 10 }, (_, i) => 
        SocketSingleton.getSocketsInRoom(`ROOM${i}`)
      );

      await Promise.all(promises);

      expect(mockNamespace.in).toHaveBeenCalledTimes(10);
      expect(mockAllSockets).toHaveBeenCalledTimes(10);
    });
  });
}); 