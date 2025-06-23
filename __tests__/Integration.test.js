/**
 * Integration tests for Game Service
 * Tests complete workflows combining HTTP API and Socket functionality
 */

const httpMocks = require('node-mocks-http');
const { Server } = require('socket.io');
const Client = require('socket.io-client');

// Mock Redis for integration tests
jest.mock('../RedisSingleton', () => {
  const mockStore = new Map();
  const mockExpiry = new Map();
  
  return {
    data: mockStore,
    expiry: mockExpiry,
    
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
    
    _clear() {
      this.data.clear();
      this.expiry.clear();
    }
  };
});

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

describe('Game Service Integration Tests', () => {
  beforeEach(() => {
    redisClient._clear();
    jest.clearAllMocks();
  });

  describe('Room Lifecycle Integration', () => {
    it('should complete full room workflow: create → join → get → delete', async () => {
      // 1. Create room via HTTP API
      const createReq = httpMocks.createRequest({
        method: 'POST',
        url: '/',
        body: { nickname: 'HostUser' }
      });
      const createRes = httpMocks.createResponse();

      await callRouteHandler('POST', '/', createReq, createRes);
      
      expect(createRes._getStatusCode()).toBe(201);
      const createData = JSON.parse(createRes._getData());
      const { roomCode, userId: hostId } = createData;

      // 2. Second user joins room
      const joinReq = httpMocks.createRequest({
        method: 'POST',
        url: `/${roomCode}/join`,
        params: { roomCode },
        body: { nickname: 'Player1' }
      });
      const joinRes = httpMocks.createResponse();

      await callRouteHandler('POST', '/:roomCode/join', joinReq, joinRes);
      
      expect(joinRes._getStatusCode()).toBe(200);
      const joinData = JSON.parse(joinRes._getData());
      expect(joinData.room.users).toHaveLength(2);

      // 3. Get room details to verify state
      const getReq = httpMocks.createRequest({
        method: 'GET',
        url: `/${roomCode}`,
        params: { roomCode }
      });
      const getRes = httpMocks.createResponse();

      await callRouteHandler('GET', '/:roomCode', getReq, getRes);
      
      const getData = JSON.parse(getRes._getData());
      expect(getData.room.users).toHaveLength(2);
      expect(getData.room.users[0].isHost).toBe(true);
      expect(getData.room.users[1].isHost).toBe(false);

      // 4. Delete room
      const deleteReq = httpMocks.createRequest({
        method: 'DELETE',
        url: `/${roomCode}`,
        params: { roomCode }
      });
      const deleteRes = httpMocks.createResponse();

      await callRouteHandler('DELETE', '/:roomCode', deleteReq, deleteRes);
      expect(deleteRes._getStatusCode()).toBe(200);

      // 5. Verify room is deleted
      const getReq2 = httpMocks.createRequest({
        method: 'GET',
        url: `/${roomCode}`,
        params: { roomCode }
      });
      const getRes2 = httpMocks.createResponse();

      await callRouteHandler('GET', '/:roomCode', getReq2, getRes2);
      expect(getRes2._getStatusCode()).toBe(404);
    });

    it('should handle multiple users joining and leaving dynamically', async () => {
      // Create room
      const createReq = httpMocks.createRequest({
        method: 'POST',
        url: '/',
        body: { nickname: 'Host' }
      });
      const createRes = httpMocks.createResponse();
      await callRouteHandler('POST', '/', createReq, createRes);
      const roomCode = JSON.parse(createRes._getData()).roomCode;

      // Add multiple players
      const players = ['Player1', 'Player2', 'Player3', 'Player4'];
      for (const player of players) {
        const joinReq = httpMocks.createRequest({
          method: 'POST',
          url: `/${roomCode}/join`,
          params: { roomCode },
          body: { nickname: player }
        });
        const joinRes = httpMocks.createResponse();
        await callRouteHandler('POST', '/:roomCode/join', joinReq, joinRes);
        expect(joinRes._getStatusCode()).toBe(200);
      }

      // Verify all users are present
      const getReq = httpMocks.createRequest({
        method: 'GET',
        url: `/${roomCode}`,
        params: { roomCode }
      });
      const getRes = httpMocks.createResponse();
      await callRouteHandler('GET', '/:roomCode', getReq, getRes);
      
      const roomData = JSON.parse(getRes._getData()).room;
      expect(roomData.users).toHaveLength(5); // Host + 4 players
      
      // Verify host permissions
      expect(roomData.users[0].nickname).toBe('Host');
      expect(roomData.users[0].isHost).toBe(true);
      
      // Verify players don't have host permissions
      for (let i = 1; i < roomData.users.length; i++) {
        expect(roomData.users[i].isHost).toBe(false);
      }
    });
  });

  describe('Error Handling Integration', () => {
    it('should handle attempts to join non-existent rooms', async () => {
      const joinReq = httpMocks.createRequest({
        method: 'POST',
        url: '/INVALID/join',
        params: { roomCode: 'INVALID' },
        body: { nickname: 'Player1' }
      });
      const joinRes = httpMocks.createResponse();

      await callRouteHandler('POST', '/:roomCode/join', joinReq, joinRes);
      
      expect(joinRes._getStatusCode()).toBe(404);
      const data = JSON.parse(joinRes._getData());
      expect(data.error).toBe('Room not found');
    });

    it('should prevent duplicate nicknames in same room', async () => {
      // Create room
      const createReq = httpMocks.createRequest({
        method: 'POST',
        url: '/',
        body: { nickname: 'UniqueUser' }
      });
      const createRes = httpMocks.createResponse();
      await callRouteHandler('POST', '/', createReq, createRes);
      const roomCode = JSON.parse(createRes._getData()).roomCode;

      // Try to join with same nickname
      const joinReq = httpMocks.createRequest({
        method: 'POST',
        url: `/${roomCode}/join`,
        params: { roomCode },
        body: { nickname: 'UniqueUser' }
      });
      const joinRes = httpMocks.createResponse();

      await callRouteHandler('POST', '/:roomCode/join', joinReq, joinRes);
      
      expect(joinRes._getStatusCode()).toBe(400);
      const data = JSON.parse(joinRes._getData());
      expect(data.error).toBe('Nickname already taken in this room');
    });

    it('should prevent joining room with game in progress', async () => {
      // Create room
      const createReq = httpMocks.createRequest({
        method: 'POST',
        url: '/',
        body: { nickname: 'Host' }
      });
      const createRes = httpMocks.createResponse();
      await callRouteHandler('POST', '/', createReq, createRes);
      const roomCode = JSON.parse(createRes._getData()).roomCode;

      // Manually start game by modifying Redis data
      const roomKey = `room:${roomCode}`;
      const roomData = JSON.parse(await redisClient.get(roomKey));
      roomData.gameStarted = true;
      await redisClient.set(roomKey, JSON.stringify(roomData), 'EX', 3600);

      // Try to join room with game started
      const joinReq = httpMocks.createRequest({
        method: 'POST',
        url: `/${roomCode}/join`,
        params: { roomCode },
        body: { nickname: 'LatePlayer' }
      });
      const joinRes = httpMocks.createResponse();

      await callRouteHandler('POST', '/:roomCode/join', joinReq, joinRes);
      
      expect(joinRes._getStatusCode()).toBe(400);
      const data = JSON.parse(joinRes._getData());
      expect(data.error).toBe('Game already in progress');
    });
  });

  describe('Stress Test Integration', () => {
    it('should handle stress test endpoint with various intensities', async () => {
      const intensities = [1000, 10000, 50000, 100000];
      
      for (const intensity of intensities) {
        const req = httpMocks.createRequest({
          method: 'POST',
          url: '/stress-test',
          body: { intensity }
        });
        const res = httpMocks.createResponse();

        const startTime = Date.now();
        await callRouteHandler('POST', '/stress-test', req, res);
        const endTime = Date.now();
        
        expect(res._getStatusCode()).toBe(200);
        const data = JSON.parse(res._getData());
        
        expect(data.intensity).toBe(intensity);
        expect(typeof data.result).toBe('number');
        expect(data.result).toBeDefined();
        expect(parseInt(data.duration.replace('ms', ''))).toBeGreaterThan(0);
        
        // Higher intensity should generally take longer
        if (intensity >= 50000) {
          expect(endTime - startTime).toBeGreaterThan(10); // At least 10ms
        }
      }
    });

    it('should handle concurrent stress tests', async () => {
      const concurrentTests = 5;
      const promises = [];

      for (let i = 0; i < concurrentTests; i++) {
        const req = httpMocks.createRequest({
          method: 'POST',
          url: '/stress-test',
          body: { intensity: 20000 }
        });
        const res = httpMocks.createResponse();

        promises.push(callRouteHandler('POST', '/stress-test', req, res)
          .then(() => ({ res, testId: i })));
      }

      const results = await Promise.all(promises);
      
      // All tests should succeed
      results.forEach(({ res, testId }) => {
        expect(res._getStatusCode()).toBe(200);
        const data = JSON.parse(res._getData());
        expect(data.intensity).toBe(20000);
        expect(data.result).toBeGreaterThan(0);
      });
    });
  });

  describe('Data Consistency Integration', () => {
    it('should maintain consistent room state across operations', async () => {
      // Create room
      const createReq = httpMocks.createRequest({
        method: 'POST',
        url: '/',
        body: { nickname: 'ConsistencyHost' }
      });
      const createRes = httpMocks.createResponse();
      await callRouteHandler('POST', '/', createReq, createRes);
      
      const createData = JSON.parse(createRes._getData());
      const roomCode = createData.roomCode;
      const hostId = createData.userId;

      // Verify room structure is consistent
      expect(createData.joinUrl).toBe(`/room/${roomCode}`);
      
      // Get room and verify consistency
      const getReq1 = httpMocks.createRequest({
        method: 'GET',
        url: `/${roomCode}`,
        params: { roomCode }
      });
      const getRes1 = httpMocks.createResponse();
      await callRouteHandler('GET', '/:roomCode', getReq1, getRes1);
      
      const room1 = JSON.parse(getRes1._getData()).room;
      expect(room1.users).toHaveLength(1);
      expect(room1.users[0].id).toBe(hostId);
      expect(room1.users[0].nickname).toBe('ConsistencyHost');
      expect(room1.users[0].isHost).toBe(true);
      expect(room1.gameStarted).toBe(false);
      expect(room1.rounds).toBe(0);
      expect(room1.currentRound).toBe(0);
      expect(room1.currentDrawer).toBeNull();

      // Add player
      const joinReq = httpMocks.createRequest({
        method: 'POST',
        url: `/${roomCode}/join`,
        params: { roomCode },
        body: { nickname: 'ConsistencyPlayer' }
      });
      const joinRes = httpMocks.createResponse();
      await callRouteHandler('POST', '/:roomCode/join', joinReq, joinRes);
      
      const joinData = JSON.parse(joinRes._getData());
      const playerId = joinData.userId;

      // Verify consistency after join
      const getReq2 = httpMocks.createRequest({
        method: 'GET',
        url: `/${roomCode}`,
        params: { roomCode }
      });
      const getRes2 = httpMocks.createResponse();
      await callRouteHandler('GET', '/:roomCode', getReq2, getRes2);
      
      const room2 = JSON.parse(getRes2._getData()).room;
      expect(room2.users).toHaveLength(2);
      expect(room2.users[0].id).toBe(hostId);
      expect(room2.users[1].id).toBe(playerId);
      expect(room2.users[0].isHost).toBe(true);
      expect(room2.users[1].isHost).toBe(false);

      // Verify timestamps are reasonable
      expect(room2.createdAt).toBeGreaterThan(Date.now() - 10000); // Within last 10 seconds
      expect(room2.users[0].joinedAt).toBeGreaterThan(Date.now() - 10000);
      expect(room2.users[1].joinedAt).toBeGreaterThan(Date.now() - 10000);
      expect(room2.users[1].joinedAt).toBeGreaterThanOrEqual(room2.users[0].joinedAt);
    });

    it('should handle room expiration correctly', async () => {
      // This test would verify TTL behavior, but requires Redis mock enhancement
      // For now, we verify that TTL is set correctly in the calls
      
      const createReq = httpMocks.createRequest({
        method: 'POST',
        url: '/',
        body: { nickname: 'TTLTest' }
      });
      const createRes = httpMocks.createResponse();
      
      // Spy on Redis set to verify TTL
      const setSpy = jest.spyOn(redisClient, 'set');
      
      await callRouteHandler('POST', '/', createReq, createRes);
      
      // Verify TTL was set (EX flag with 3600 seconds)
      expect(setSpy).toHaveBeenCalledWith(
        expect.stringMatching(/^room:/),
        expect.any(String),
        'EX',
        3600
      );
    });
  });

  describe('Performance Integration', () => {
    it('should handle rapid room creation and deletion', async () => {
      const numRooms = 10;
      const roomCodes = [];

      // Rapid room creation
      for (let i = 0; i < numRooms; i++) {
        const createReq = httpMocks.createRequest({
          method: 'POST',
          url: '/',
          body: { nickname: `RapidUser${i}` }
        });
        const createRes = httpMocks.createResponse();

        await callRouteHandler('POST', '/', createReq, createRes);
        
        expect(createRes._getStatusCode()).toBe(201);
        const data = JSON.parse(createRes._getData());
        roomCodes.push(data.roomCode);
      }

      // Verify all rooms exist
      for (const roomCode of roomCodes) {
        const getReq = httpMocks.createRequest({
          method: 'GET',
          url: `/${roomCode}`,
          params: { roomCode }
        });
        const getRes = httpMocks.createResponse();

        await callRouteHandler('GET', '/:roomCode', getReq, getRes);
        expect(getRes._getStatusCode()).toBe(200);
      }

      // Rapid room deletion
      for (const roomCode of roomCodes) {
        const deleteReq = httpMocks.createRequest({
          method: 'DELETE',
          url: `/${roomCode}`,
          params: { roomCode }
        });
        const deleteRes = httpMocks.createResponse();

        await callRouteHandler('DELETE', '/:roomCode', deleteReq, deleteRes);
        expect(deleteRes._getStatusCode()).toBe(200);
      }

      // Verify all rooms are deleted
      for (const roomCode of roomCodes) {
        const getReq = httpMocks.createRequest({
          method: 'GET',
          url: `/${roomCode}`,
          params: { roomCode }
        });
        const getRes = httpMocks.createResponse();

        await callRouteHandler('GET', '/:roomCode', getReq, getRes);
        expect(getRes._getStatusCode()).toBe(404);
      }
    });

    it('should maintain performance under load', async () => {
      const startTime = Date.now();
      
      // Create multiple rooms concurrently
      const createPromises = Array.from({ length: 20 }, (_, i) => {
        const req = httpMocks.createRequest({
          method: 'POST',
          url: '/',
          body: { nickname: `LoadUser${i}` }
        });
        const res = httpMocks.createResponse();
        return callRouteHandler('POST', '/', req, res).then(() => res);
      });

      const createResults = await Promise.all(createPromises);
      const createTime = Date.now() - startTime;

      // All should succeed
      createResults.forEach(res => {
        expect(res._getStatusCode()).toBe(201);
      });

      // Should complete reasonably quickly
      expect(createTime).toBeLessThan(1000); // Within 1 second

      // Extract room codes for cleanup
      const roomCodes = createResults.map(res => 
        JSON.parse(res._getData()).roomCode
      );

      // Add concurrent stress tests
      const stressStartTime = Date.now();
      const stressPromises = Array.from({ length: 5 }, () => {
        const req = httpMocks.createRequest({
          method: 'POST',
          url: '/stress-test',
          body: { intensity: 10000 }
        });
        const res = httpMocks.createResponse();
        return callRouteHandler('POST', '/stress-test', req, res).then(() => res);
      });

      const stressResults = await Promise.all(stressPromises);
      const stressTime = Date.now() - stressStartTime;

      // All stress tests should succeed
      stressResults.forEach(res => {
        expect(res._getStatusCode()).toBe(200);
      });

      // Clean up rooms
      for (const roomCode of roomCodes) {
        const deleteReq = httpMocks.createRequest({
          method: 'DELETE',
          url: `/${roomCode}`,
          params: { roomCode }
        });
        const deleteRes = httpMocks.createResponse();
        await callRouteHandler('DELETE', '/:roomCode', deleteReq, deleteRes);
      }
    });
  });
}); 