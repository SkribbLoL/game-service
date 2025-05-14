/**
 * Tests for RedisSingleton.js
 */

// Mock Redis module before importing RedisSingleton
jest.mock('ioredis', () => {
  // Define a mock implementation inside the factory function
  return jest.fn().mockImplementation(() => {
    const mockStore = new Map();
    return {
      on: jest.fn().mockReturnThis(),
      get: jest.fn().mockImplementation(key => {
        return Promise.resolve(mockStore.get(key) || null);
      }),
      set: jest.fn().mockImplementation((key, value) => {
        mockStore.set(key, value);
        return Promise.resolve('OK');
      }),
      del: jest.fn().mockImplementation(key => {
        return Promise.resolve(mockStore.delete(key) ? 1 : 0);
      })
    };
  });
});

// Import the module after mocking
const redisClient = require('../RedisSingleton');

describe('RedisSingleton Tests', () => {
  beforeEach(() => {
    // Clear data between tests
    jest.clearAllMocks();
  });

  test('should store and retrieve data', async () => {
    // Setup a spy on the implementation
    const setMock = jest.spyOn(redisClient, 'set');
    const getMock = jest.spyOn(redisClient, 'get');
    
    // Test data
    const testKey = 'test-key';
    const testValue = 'test-value';

    // Act
    await redisClient.set(testKey, testValue);
    expect(setMock).toHaveBeenCalledWith(testKey, testValue);
    
    // Mock the get response
    getMock.mockResolvedValueOnce(testValue);
    const retrievedValue = await redisClient.get(testKey);

    // Assert
    expect(getMock).toHaveBeenCalledWith(testKey);
    expect(retrievedValue).toBe(testValue);
  });

  test('should delete data', async () => {
    // Setup spies
    const setMock = jest.spyOn(redisClient, 'set');
    const delMock = jest.spyOn(redisClient, 'del');
    const getMock = jest.spyOn(redisClient, 'get');
    
    // Test data
    const testKey = 'test-key-to-delete';
    const testValue = 'test-value';
    
    // Act
    await redisClient.set(testKey, testValue);
    expect(setMock).toHaveBeenCalledWith(testKey, testValue);
    
    await redisClient.del(testKey);
    expect(delMock).toHaveBeenCalledWith(testKey);
    
    // Mock the get response after deletion
    getMock.mockResolvedValueOnce(null);
    const retrievedValue = await redisClient.get(testKey);

    // Assert
    expect(retrievedValue).toBeNull();
  });

  test('should set data with expiry', async () => {
    // Setup spy
    const setMock = jest.spyOn(redisClient, 'set');
    const getMock = jest.spyOn(redisClient, 'get');
    
    // Test data
    const testKey = 'test-key-with-expiry';
    const testValue = 'expiry-value';
    
    // Act
    await redisClient.set(testKey, testValue, 'EX', 60);
    expect(setMock).toHaveBeenCalledWith(testKey, testValue, 'EX', 60);
    
    // Mock the get response
    getMock.mockResolvedValueOnce(testValue);
    const retrievedValue = await redisClient.get(testKey);

    // Assert
    expect(retrievedValue).toBe(testValue);
  });
}); 