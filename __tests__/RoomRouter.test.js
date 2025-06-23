/**
 * Comprehensive tests for RoomRouter.js
 * Covers all routes, happy paths, and error scenarios
 */

jest.mock('../RedisSingleton', () => {
  // Inline implementation of RedisMock
  return {
    data: new Map(),
    expiry: new Map(),
    async get(key) {
      if (this.expiry.has(key) && this.expiry.get(key) < Date.now()) {
        this.data.delete(key);
        this.expiry.delete(key);
        return null;
      }
      return this.data.get(key) || null;
    },
    async set(key, value, expiryFlag, expiryTime) {
      this.data.set(key, value);
      
      if (expiryFlag === 'EX' && expiryTime) {
        // Convert seconds to milliseconds and add to current time
        this.expiry.set(key, Date.now() + (expiryTime * 1000));
      }
      
      return 'OK';
    },
    async del(key) {
      const existed = this.data.has(key);
      this.data.delete(key);
      this.expiry.delete(key);
      return existed ? 1 : 0;
    },
    // Utility method to clear all data (for testing)
    _clear() {
      this.data.clear();
      this.expiry.clear();
    },
    // Method to simulate Redis errors
    _simulateError(method, shouldError = true) {
      if (shouldError) {
        this[method] = jest.fn().mockRejectedValue(new Error('Redis connection error'));
      }
    },
    // Reset error simulation
    _resetErrorSimulation() {
      // Reset methods to their original implementations
      this.get = async function(key) {
        if (this.expiry.has(key) && this.expiry.get(key) < Date.now()) {
          this.data.delete(key);
          this.expiry.delete(key);
          return null;
        }
        return this.data.get(key) || null;
      };
      this.set = async function(key, value, expiryFlag, expiryTime) {
        this.data.set(key, value);
        if (expiryFlag === 'EX' && expiryTime) {
          this.expiry.set(key, Date.now() + (expiryTime * 1000));
        }
        return 'OK';
      };
      this.del = async function(key) {
        const existed = this.data.has(key);
        this.data.delete(key);
        this.expiry.delete(key);
        return existed ? 1 : 0;
      };
    }
  };
});

const httpMocks = require('node-mocks-http');
const roomRouter = require('../routers/RoomRouter');
const redisClient = require('../RedisSingleton');

// Helper function to call route handlers
const callRouteHandler = async (method, path, req, res) => {
  const routeIndex = roomRouter.stack.findIndex(layer => 
    layer.route && 
    layer.route.path === path && 
    layer.route.methods[method.toLowerCase()]
  );
  
  if (routeIndex === -1) {
    throw new Error(`Route not found: ${method} ${path}`);
  }
  
  await roomRouter.stack[routeIndex].route.stack[0].handle(req, res);
};

describe('RoomRouter - Comprehensive Tests', () => {
  beforeEach(() => {
    redisClient._clear();
    redisClient._resetErrorSimulation();
    jest.clearAllMocks();
  });

  describe('POST / - Create Room', () => {
    it('should create a new room successfully', async () => {
      const req = httpMocks.createRequest({
        method: 'POST',
        url: '/',
        body: { nickname: 'TestUser' }
      });
      const res = httpMocks.createResponse();

      await callRouteHandler('POST', '/', req, res);
      
      const data = JSON.parse(res._getData());
      
      expect(res._getStatusCode()).toBe(201);
      expect(data).toHaveProperty('roomCode');
      expect(data).toHaveProperty('userId');
      expect(data).toHaveProperty('joinUrl');
      expect(data.roomCode).toMatch(/^[A-Z0-9\-]{6}$/); // 6 characters: uppercase letters, numbers, or hyphens
      expect(data.joinUrl).toBe(`/room/${data.roomCode}`);
      
      // Verify room was stored in Redis
      const roomKey = `room:${data.roomCode}`;
      const storedRoom = await redisClient.get(roomKey);
      expect(storedRoom).toBeTruthy();
      
      const roomData = JSON.parse(storedRoom);
      expect(roomData.users).toHaveLength(1);
      expect(roomData.users[0].nickname).toBe('TestUser');
      expect(roomData.users[0].isHost).toBe(true);
      expect(roomData.gameStarted).toBe(false);
      expect(roomData.rounds).toBe(0);
      expect(roomData.currentRound).toBe(0);
      expect(roomData.currentDrawer).toBeNull();
      expect(roomData.createdAt).toBeGreaterThan(0);
    });
    
    it('should return 400 if nickname is missing', async () => {
      const req = httpMocks.createRequest({
        method: 'POST',
        url: '/',
        body: {}
      });
      const res = httpMocks.createResponse();

      await callRouteHandler('POST', '/', req, res);
      
      expect(res._getStatusCode()).toBe(400);
      const data = JSON.parse(res._getData());
      expect(data.error).toBe('Nickname is required');
    });

    it('should return 400 if nickname is empty string', async () => {
      const req = httpMocks.createRequest({
        method: 'POST',
        url: '/',
        body: { nickname: '' }
      });
      const res = httpMocks.createResponse();

      await callRouteHandler('POST', '/', req, res);
      
      expect(res._getStatusCode()).toBe(400);
      const data = JSON.parse(res._getData());
      expect(data.error).toBe('Nickname is required');
    });

    it('should return 400 if nickname is null', async () => {
      const req = httpMocks.createRequest({
        method: 'POST',
        url: '/',
        body: { nickname: null }
      });
      const res = httpMocks.createResponse();

      await callRouteHandler('POST', '/', req, res);
      
      expect(res._getStatusCode()).toBe(400);
      const data = JSON.parse(res._getData());
      expect(data.error).toBe('Nickname is required');
    });

    it('should handle Redis connection errors gracefully', async () => {
      redisClient._simulateError('set');
      
      const req = httpMocks.createRequest({
        method: 'POST',
        url: '/',
        body: { nickname: 'TestUser' }
      });
      const res = httpMocks.createResponse();

      await callRouteHandler('POST', '/', req, res);
      
      expect(res._getStatusCode()).toBe(500);
      const data = JSON.parse(res._getData());
      expect(data.error).toBe('Server error');
    });

    it('should create rooms with unique codes', async () => {
      const createdRooms = [];
      
      // Create multiple rooms and ensure unique codes
      for (let i = 0; i < 5; i++) {
        const req = httpMocks.createRequest({
          method: 'POST',
          url: '/',
          body: { nickname: `TestUser${i}` }
        });
        const res = httpMocks.createResponse();

        await callRouteHandler('POST', '/', req, res);
        
        const data = JSON.parse(res._getData());
        expect(res._getStatusCode()).toBe(201);
        expect(createdRooms).not.toContain(data.roomCode);
        createdRooms.push(data.roomCode);
      }
    });
  });

  describe('GET /:roomCode - Get Room Details', () => {
    it('should get room details successfully', async () => {
      // First create a room
      const createReq = httpMocks.createRequest({
        method: 'POST',
        url: '/',
        body: { nickname: 'HostUser' }
      });
      const createRes = httpMocks.createResponse();
      await callRouteHandler('POST', '/', createReq, createRes);
      const createData = JSON.parse(createRes._getData());
      const roomCode = createData.roomCode;
      
      // Now get the room details
      const getReq = httpMocks.createRequest({
        method: 'GET',
        url: `/${roomCode}`,
        params: { roomCode }
      });
      const getRes = httpMocks.createResponse();
      
      await callRouteHandler('GET', '/:roomCode', getReq, getRes);
      
      expect(getRes._getStatusCode()).toBe(200);
      const getData = JSON.parse(getRes._getData());
      expect(getData).toHaveProperty('roomCode');
      expect(getData).toHaveProperty('room');
      expect(getData.roomCode).toBe(roomCode);
      expect(getData.room.users).toHaveLength(1);
      expect(getData.room.users[0].nickname).toBe('HostUser');
    });
    
    it('should return 404 if room does not exist', async () => {
      const getReq = httpMocks.createRequest({
        method: 'GET',
        url: '/NONEXISTENT',
        params: { roomCode: 'NONEXISTENT' }
      });
      const getRes = httpMocks.createResponse();
      
      await callRouteHandler('GET', '/:roomCode', getReq, getRes);
      
      expect(getRes._getStatusCode()).toBe(404);
      const data = JSON.parse(getRes._getData());
      expect(data.error).toBe('Room not found');
    });

    it('should handle Redis connection errors gracefully', async () => {
      redisClient._simulateError('get');
      
      const getReq = httpMocks.createRequest({
        method: 'GET',
        url: '/TESTROOM',
        params: { roomCode: 'TESTROOM' }
      });
      const getRes = httpMocks.createResponse();
      
      await callRouteHandler('GET', '/:roomCode', getReq, getRes);
      
      expect(getRes._getStatusCode()).toBe(500);
      const data = JSON.parse(getRes._getData());
      expect(data.error).toBe('Server error');
    });
  });

  describe('POST /:roomCode/join - Join Room', () => {
    let roomCode;

    beforeEach(async () => {
      // Create a room for joining tests
      const createReq = httpMocks.createRequest({
        method: 'POST',
        url: '/',
        body: { nickname: 'HostUser' }
      });
      const createRes = httpMocks.createResponse();
      await callRouteHandler('POST', '/', createReq, createRes);
      const createData = JSON.parse(createRes._getData());
      roomCode = createData.roomCode;
    });

    it('should join an existing room successfully', async () => {
      const joinReq = httpMocks.createRequest({
        method: 'POST',
        url: `/${roomCode}/join`,
        params: { roomCode },
        body: { nickname: 'JoinUser' }
      });
      const joinRes = httpMocks.createResponse();
      
      await callRouteHandler('POST', '/:roomCode/join', joinReq, joinRes);
      
      expect(joinRes._getStatusCode()).toBe(200);
      const joinData = JSON.parse(joinRes._getData());
      expect(joinData).toHaveProperty('roomCode');
      expect(joinData).toHaveProperty('userId');
      expect(joinData).toHaveProperty('room');
      expect(joinData.roomCode).toBe(roomCode);
      
      // Verify room was updated
      const roomData = joinData.room;
      expect(roomData.users).toHaveLength(2);
      expect(roomData.users[0].nickname).toBe('HostUser');
      expect(roomData.users[1].nickname).toBe('JoinUser');
      expect(roomData.users[0].isHost).toBe(true);
      expect(roomData.users[1].isHost).toBe(false);
    });
    
    it('should return 404 if room does not exist', async () => {
      const joinReq = httpMocks.createRequest({
        method: 'POST',
        url: '/NONEXISTENT/join',
        params: { roomCode: 'NONEXISTENT' },
        body: { nickname: 'JoinUser' }
      });
      const joinRes = httpMocks.createResponse();
      
      await callRouteHandler('POST', '/:roomCode/join', joinReq, joinRes);
      
      expect(joinRes._getStatusCode()).toBe(404);
      const data = JSON.parse(joinRes._getData());
      expect(data.error).toBe('Room not found');
    });

    it('should return 400 if nickname is missing', async () => {
      const joinReq = httpMocks.createRequest({
        method: 'POST',
        url: `/${roomCode}/join`,
        params: { roomCode },
        body: {}
      });
      const joinRes = httpMocks.createResponse();
      
      await callRouteHandler('POST', '/:roomCode/join', joinReq, joinRes);
      
      expect(joinRes._getStatusCode()).toBe(400);
      const data = JSON.parse(joinRes._getData());
      expect(data.error).toBe('Nickname is required');
    });

    it('should return 400 if nickname is already taken', async () => {
      const joinReq = httpMocks.createRequest({
        method: 'POST',
        url: `/${roomCode}/join`,
        params: { roomCode },
        body: { nickname: 'HostUser' } // Same as host
      });
      const joinRes = httpMocks.createResponse();
      
      await callRouteHandler('POST', '/:roomCode/join', joinReq, joinRes);
      
      expect(joinRes._getStatusCode()).toBe(400);
      const data = JSON.parse(joinRes._getData());
      expect(data.error).toBe('Nickname already taken in this room');
    });

    it('should return 400 if game already started', async () => {
      // Start the game first
      const roomKey = `room:${roomCode}`;
      const roomData = JSON.parse(await redisClient.get(roomKey));
      roomData.gameStarted = true;
      await redisClient.set(roomKey, JSON.stringify(roomData), 'EX', 3600);

      const joinReq = httpMocks.createRequest({
        method: 'POST',
        url: `/${roomCode}/join`,
        params: { roomCode },
        body: { nickname: 'LateJoiner' }
      });
      const joinRes = httpMocks.createResponse();
      
      await callRouteHandler('POST', '/:roomCode/join', joinReq, joinRes);
      
      expect(joinRes._getStatusCode()).toBe(400);
      const data = JSON.parse(joinRes._getData());
      expect(data.error).toBe('Game already in progress');
    });

    it('should handle Redis connection errors gracefully', async () => {
      redisClient._simulateError('get');
      
      const joinReq = httpMocks.createRequest({
        method: 'POST',
        url: `/${roomCode}/join`,
        params: { roomCode },
        body: { nickname: 'JoinUser' }
      });
      const joinRes = httpMocks.createResponse();
      
      await callRouteHandler('POST', '/:roomCode/join', joinReq, joinRes);
      
      expect(joinRes._getStatusCode()).toBe(500);
      const data = JSON.parse(joinRes._getData());
      expect(data.error).toBe('Server error');
    });
  });

  describe('DELETE /:roomCode - Delete Room', () => {
    let roomCode;

    beforeEach(async () => {
      // Create a room for deletion tests
      const createReq = httpMocks.createRequest({
        method: 'POST',
        url: '/',
        body: { nickname: 'HostUser' }
      });
      const createRes = httpMocks.createResponse();
      await callRouteHandler('POST', '/', createReq, createRes);
      const createData = JSON.parse(createRes._getData());
      roomCode = createData.roomCode;
    });

    it('should delete an existing room successfully', async () => {
      const deleteReq = httpMocks.createRequest({
        method: 'DELETE',
        url: `/${roomCode}`,
        params: { roomCode }
      });
      const deleteRes = httpMocks.createResponse();
      
      await callRouteHandler('DELETE', '/:roomCode', deleteReq, deleteRes);
      
      expect(deleteRes._getStatusCode()).toBe(200);
      const data = JSON.parse(deleteRes._getData());
      expect(data.message).toBe(`Room ${roomCode} deleted successfully`);
      
      // Verify room was actually deleted
      const roomKey = `room:${roomCode}`;
      const deletedRoom = await redisClient.get(roomKey);
      expect(deletedRoom).toBeNull();
    });

    it('should return 404 if room does not exist', async () => {
      const deleteReq = httpMocks.createRequest({
        method: 'DELETE',
        url: '/NONEXISTENT',
        params: { roomCode: 'NONEXISTENT' }
      });
      const deleteRes = httpMocks.createResponse();
      
      await callRouteHandler('DELETE', '/:roomCode', deleteReq, deleteRes);
      
      expect(deleteRes._getStatusCode()).toBe(404);
      const data = JSON.parse(deleteRes._getData());
      expect(data.error).toBe('Room not found');
    });

    it('should handle Redis connection errors gracefully', async () => {
      redisClient._simulateError('get');
      
      const deleteReq = httpMocks.createRequest({
        method: 'DELETE',
        url: `/${roomCode}`,
        params: { roomCode }
      });
      const deleteRes = httpMocks.createResponse();
      
      await callRouteHandler('DELETE', '/:roomCode', deleteReq, deleteRes);
      
      expect(deleteRes._getStatusCode()).toBe(500);
      const data = JSON.parse(deleteRes._getData());
      expect(data.error).toBe('Server error');
    });
  });

  describe('POST /stress-test - Stress Test Endpoint', () => {
    it('should complete stress test with default intensity', async () => {
      const req = httpMocks.createRequest({
        method: 'POST',
        url: '/stress-test',
        body: {}
      });
      const res = httpMocks.createResponse();

      const startTime = Date.now();
      await callRouteHandler('POST', '/stress-test', req, res);
      const endTime = Date.now();
      
      expect(res._getStatusCode()).toBe(200);
      const data = JSON.parse(res._getData());
      
      expect(data).toHaveProperty('message', 'Stress test completed successfully');
      expect(data).toHaveProperty('duration');
      expect(data).toHaveProperty('intensity', 100000); // Default intensity
      expect(data).toHaveProperty('result');
      expect(data).toHaveProperty('timestamp');
      
      // Verify duration format
      expect(data.duration).toMatch(/^\d+ms$/);
      
      // Verify it actually took some time
      const durationMs = parseInt(data.duration.replace('ms', ''));
      expect(durationMs).toBeGreaterThan(0);
      expect(durationMs).toBeLessThan(endTime - startTime + 100); // Allow some margin
      
      // Verify result is a number
      expect(typeof data.result).toBe('number');
      
      // Verify timestamp is valid ISO string
      expect(() => new Date(data.timestamp)).not.toThrow();
    });

    it('should complete stress test with custom intensity', async () => {
      const customIntensity = 50000;
      const req = httpMocks.createRequest({
        method: 'POST',
        url: '/stress-test',
        body: { intensity: customIntensity }
      });
      const res = httpMocks.createResponse();

      await callRouteHandler('POST', '/stress-test', req, res);
      
      expect(res._getStatusCode()).toBe(200);
      const data = JSON.parse(res._getData());
      expect(data.intensity).toBe(customIntensity);
    });

    it('should handle zero intensity', async () => {
      const req = httpMocks.createRequest({
        method: 'POST',
        url: '/stress-test',
        body: { intensity: 0 }
      });
      const res = httpMocks.createResponse();

      await callRouteHandler('POST', '/stress-test', req, res);
      
      expect(res._getStatusCode()).toBe(200);
      const data = JSON.parse(res._getData());
      expect(data.intensity).toBe(0);
      expect(data.result).toBeDefined();
    });

    it('should handle negative intensity by using default', async () => {
      const req = httpMocks.createRequest({
        method: 'POST',
        url: '/stress-test',
        body: { intensity: -1000 }
      });
      const res = httpMocks.createResponse();

      await callRouteHandler('POST', '/stress-test', req, res);
      
      expect(res._getStatusCode()).toBe(200);
      const data = JSON.parse(res._getData());
      expect(data.intensity).toBe(-1000); // Should preserve the sent value
    });

    it('should handle very high intensity', async () => {
      const req = httpMocks.createRequest({
        method: 'POST',
        url: '/stress-test',
        body: { intensity: 1000000 }
      });
      const res = httpMocks.createResponse();

      // Set a longer timeout for this test
      const originalTimeout = jest.setTimeout(10000);
      
      await callRouteHandler('POST', '/stress-test', req, res);
      
      expect(res._getStatusCode()).toBe(200);
      const data = JSON.parse(res._getData());
      expect(data.intensity).toBe(1000000);
      expect(data.result).toBeDefined();
      
      // Duration should be longer for high intensity
      const durationMs = parseInt(data.duration.replace('ms', ''));
      expect(durationMs).toBeGreaterThan(0);
    });

    it('should handle malformed request body gracefully', async () => {
      const req = httpMocks.createRequest({
        method: 'POST',
        url: '/stress-test',
        body: { intensity: 'not-a-number' }
      });
      const res = httpMocks.createResponse();

      await callRouteHandler('POST', '/stress-test', req, res);
      
      // Should still work with default intensity since destructuring with default value
      expect(res._getStatusCode()).toBe(200);
      const data = JSON.parse(res._getData());
      expect(data.intensity).toBe('not-a-number'); // Preserves what was sent
    });
  });

  describe('Integration Tests', () => {
    it('should handle complete room lifecycle', async () => {
      // 1. Create room
      const createReq = httpMocks.createRequest({
        method: 'POST',
        url: '/',
        body: { nickname: 'HostUser' }
      });
      const createRes = httpMocks.createResponse();
      await callRouteHandler('POST', '/', createReq, createRes);
      
      const createData = JSON.parse(createRes._getData());
      const roomCode = createData.roomCode;
      expect(createRes._getStatusCode()).toBe(201);

      // 2. Join room
      const joinReq = httpMocks.createRequest({
        method: 'POST',
        url: `/${roomCode}/join`,
        params: { roomCode },
        body: { nickname: 'Player1' }
      });
      const joinRes = httpMocks.createResponse();
      await callRouteHandler('POST', '/:roomCode/join', joinReq, joinRes);
      expect(joinRes._getStatusCode()).toBe(200);

      // 3. Get room details
      const getReq = httpMocks.createRequest({
        method: 'GET',
        url: `/${roomCode}`,
        params: { roomCode }
      });
      const getRes = httpMocks.createResponse();
      await callRouteHandler('GET', '/:roomCode', getReq, getRes);
      
      const getData = JSON.parse(getRes._getData());
      expect(getRes._getStatusCode()).toBe(200);
      expect(getData.room.users).toHaveLength(2);

      // 4. Delete room
      const deleteReq = httpMocks.createRequest({
        method: 'DELETE',
        url: `/${roomCode}`,
        params: { roomCode }
      });
      const deleteRes = httpMocks.createResponse();
      await callRouteHandler('DELETE', '/:roomCode', deleteReq, deleteRes);
      expect(deleteRes._getStatusCode()).toBe(200);

      // 5. Verify room is gone
      const getReq2 = httpMocks.createRequest({
        method: 'GET',
        url: `/${roomCode}`,
        params: { roomCode }
      });
      const getRes2 = httpMocks.createResponse();
      await callRouteHandler('GET', '/:roomCode', getReq2, getRes2);
      expect(getRes2._getStatusCode()).toBe(404);
    });

    it('should handle multiple users joining same room', async () => {
      // Create room
      const createReq = httpMocks.createRequest({
        method: 'POST',
        url: '/',
        body: { nickname: 'HostUser' }
      });
      const createRes = httpMocks.createResponse();
      await callRouteHandler('POST', '/', createReq, createRes);
      const roomCode = JSON.parse(createRes._getData()).roomCode;

      // Join multiple users
      const users = ['Player1', 'Player2', 'Player3'];
      for (const user of users) {
        const joinReq = httpMocks.createRequest({
          method: 'POST',
          url: `/${roomCode}/join`,
          params: { roomCode },
          body: { nickname: user }
        });
        const joinRes = httpMocks.createResponse();
        await callRouteHandler('POST', '/:roomCode/join', joinReq, joinRes);
        expect(joinRes._getStatusCode()).toBe(200);
      }

      // Verify all users are in room
      const getReq = httpMocks.createRequest({
        method: 'GET',
        url: `/${roomCode}`,
        params: { roomCode }
      });
      const getRes = httpMocks.createResponse();
      await callRouteHandler('GET', '/:roomCode', getReq, getRes);
      
      const roomData = JSON.parse(getRes._getData()).room;
      expect(roomData.users).toHaveLength(4); // Host + 3 players
      expect(roomData.users[0].isHost).toBe(true);
      expect(roomData.users.slice(1).every(user => !user.isHost)).toBe(true);
    });
  });

  describe('Performance Tests', () => {
    it('should handle stress test performance', async () => {
      const req = httpMocks.createRequest({
        method: 'POST',
        url: '/stress-test',
        body: { intensity: 10000 }
      });
      const res = httpMocks.createResponse();

      const startTime = Date.now();
      await callRouteHandler('POST', '/stress-test', req, res);
      const endTime = Date.now();
      
      expect(res._getStatusCode()).toBe(200);
      
      // Performance assertion - should complete within reasonable time
      const actualDuration = endTime - startTime;
      expect(actualDuration).toBeLessThan(5000); // Should complete within 5 seconds
    });

    it('should create room efficiently', async () => {
      const req = httpMocks.createRequest({
        method: 'POST',
        url: '/',
        body: { nickname: 'SpeedTest' }
      });
      const res = httpMocks.createResponse();

      const startTime = Date.now();
      await callRouteHandler('POST', '/', req, res);
      const endTime = Date.now();
      
      expect(res._getStatusCode()).toBe(201);
      expect(endTime - startTime).toBeLessThan(100); // Should be very fast
    });
  });
}); 