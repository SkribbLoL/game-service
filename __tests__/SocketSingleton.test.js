/**
 * Basic tests for SocketSingleton.js
 * Tests the singleton pattern and basic functionality
 */

describe('SocketSingleton - Basic Tests', () => {
  let socketSingleton;

  beforeEach(() => {
    // Clear the module cache to get a fresh instance
    delete require.cache[require.resolve('../SocketSingleton')];
    
    // Clear all mocks
    jest.clearAllMocks();

    // Get fresh instance
    socketSingleton = require('../SocketSingleton');
  });

  describe('Singleton Pattern', () => {
    it('should always return the same instance', () => {
      const instance1 = require('../SocketSingleton');
      const instance2 = require('../SocketSingleton');
      
      expect(instance1).toBe(instance2);
    });

    it('should have expected methods', () => {
      expect(typeof socketSingleton.setup).toBe('function');
      expect(typeof socketSingleton.getIO).toBe('function');
      expect(typeof socketSingleton.emitToRoom).toBe('function');
      expect(typeof socketSingleton.getSocketsInRoom).toBe('function');
    });
  });

  describe('Basic Functionality', () => {
    it('should handle emitToRoom without crashing', () => {
      expect(() => {
        socketSingleton.emitToRoom('TEST123', 'test-event', { message: 'test' });
      }).not.toThrow();
    });

    it('should handle getSocketsInRoom without crashing', async () => {
      let result;
      expect(async () => {
        result = await socketSingleton.getSocketsInRoom('TEST123');
      }).not.toThrow();
    });

    it('should handle null/undefined parameters gracefully', () => {
      expect(() => {
        socketSingleton.emitToRoom(null, 'test', {});
      }).not.toThrow();

      expect(() => {
        socketSingleton.emitToRoom('TEST123', null, {});
      }).not.toThrow();

      expect(() => {
        socketSingleton.emitToRoom(undefined, 'test', {});
      }).not.toThrow();
    });

    it('should throw error when getIO called before setup', () => {
      expect(() => {
        socketSingleton.getIO();
      }).toThrow('Game Socket.io not initialized. Call setup() first.');
    });
  });

  describe('Error Handling', () => {
    it('should handle large data payloads', () => {
      const largeData = {
        data: 'x'.repeat(1000), // 1KB string
        array: new Array(100).fill('test'),
        nested: {
          level1: {
            level2: {
              level3: 'deep data'
            }
          }
        }
      };

      expect(() => {
        socketSingleton.emitToRoom('TEST123', 'large-data', largeData);
      }).not.toThrow();
    });

    it('should handle rapid operations', () => {
      for (let i = 0; i < 10; i++) {
        expect(() => {
          socketSingleton.emitToRoom(`ROOM${i}`, 'rapid-test', { index: i });
        }).not.toThrow();
      }
    });
  });
}); 