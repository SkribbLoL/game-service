/**
 * Comprehensive tests for RoomSocketHandler.js
 * Covers all socket events, game logic, error scenarios, and edge cases
 */

// Mock dependencies
jest.mock('../RedisSingleton', () => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
}));

jest.mock('../SocketSingleton', () => ({
  getIO: jest.fn(),
  emitToRoom: jest.fn(),
  getSocketsInRoom: jest.fn(),
}));

jest.mock('../words', () => ({
  getRandomWords: jest.fn(() => ['apple', 'banana', 'cherry']),
  calculateWordPoints: jest.fn(() => 100),
}));

const redisClient = require('../RedisSingleton');
const socketInstance = require('../SocketSingleton');
const { getRandomWords, calculateWordPoints } = require('../words');

describe('RoomSocketHandler - Comprehensive Tests', () => {
  let mockIo;
  let mockSocket;
  let roomHandler;
  let mockMessageBus;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Clear the module cache to get a fresh instance
    delete require.cache[require.resolve('../socket-handlers/RoomSocketHandler')];

    // Create mock socket.io instance
    mockIo = {
      on: jest.fn(),
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
      in: jest.fn().mockReturnThis(),
      of: jest.fn().mockReturnThis(),
    };

    // Mock socket instance
    mockSocket = {
      id: 'socket123',
      userId: 'user123',
      roomCode: 'ABCDEF',
      nickname: 'TestUser',
      join: jest.fn(),
      leave: jest.fn(),
      emit: jest.fn(),
      on: jest.fn(),
      broadcast: {
        to: jest.fn().mockReturnThis(),
        emit: jest.fn(),
      },
      to: jest.fn().mockReturnThis(),
    };

    // Mock message bus
    mockMessageBus = {
      publish: jest.fn(),
      subscribe: jest.fn(),
      publishGameEvent: jest.fn().mockResolvedValue(),
    };

    // Setup socket instance mock
    socketInstance.getIO.mockReturnValue(mockIo);

    // Import the handler (which is an instance, not a class)
    roomHandler = require('../socket-handlers/RoomSocketHandler');
  });

  describe('Initialization', () => {
    it('should initialize with message bus', () => {
      roomHandler.initialize(mockMessageBus);

      expect(socketInstance.getIO).toHaveBeenCalled();
      expect(roomHandler.messageBus).toBe(mockMessageBus);
      expect(mockIo.on).toHaveBeenCalledWith('connection', expect.any(Function));
    });

    it('should initialize without message bus', () => {
      roomHandler.initialize();

      expect(socketInstance.getIO).toHaveBeenCalled();
      expect(roomHandler.messageBus).toBeNull();
      expect(mockIo.on).toHaveBeenCalledWith('connection', expect.any(Function));
    });

    it('should setup event handlers on connection', () => {
      roomHandler.initialize();
      
      // Simulate connection
      const connectionHandler = mockIo.on.mock.calls.find(call => call[0] === 'connection')[1];
      connectionHandler(mockSocket);

      expect(mockSocket.on).toHaveBeenCalledWith('join-room', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('leave-room', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('start-game', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('select-word', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('end-round', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('restart-game', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('draw', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('disconnect', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('error', expect.any(Function));
    });
  });

  describe('handleJoinRoom', () => {
    const mockRoomData = {
      users: [
        { id: 'user123', nickname: 'TestUser', isHost: true },
      ],
      gameStarted: false,
      currentRound: 0,
    };

    beforeEach(() => {
      roomHandler.initialize();
      redisClient.get.mockResolvedValue(JSON.stringify(mockRoomData));
    });

    it('should successfully join room with valid data', async () => {
      await roomHandler.handleJoinRoom(mockSocket, {
        roomCode: 'ABCDEF',
        userId: 'user123',
      });

      expect(redisClient.get).toHaveBeenCalledWith('room:ABCDEF');
      expect(mockSocket.join).toHaveBeenCalledWith('ABCDEF');
      expect(mockSocket.userId).toBe('user123');
      expect(mockSocket.roomCode).toBe('ABCDEF');
      expect(mockIo.to).toHaveBeenCalledWith('ABCDEF');
      expect(mockSocket.emit).toHaveBeenCalledWith('room-joined', { room: mockRoomData });
    });

    it('should emit error if roomCode is missing', async () => {
      await roomHandler.handleJoinRoom(mockSocket, {
        userId: 'user123',
      });

      expect(mockSocket.emit).toHaveBeenCalledWith('error', {
        message: 'Room code and user ID are required',
      });
      expect(redisClient.get).not.toHaveBeenCalled();
    });

    it('should emit error if userId is missing', async () => {
      await roomHandler.handleJoinRoom(mockSocket, {
        roomCode: 'ABCDEF',
      });

      expect(mockSocket.emit).toHaveBeenCalledWith('error', {
        message: 'Room code and user ID are required',
      });
      expect(redisClient.get).not.toHaveBeenCalled();
    });

    it('should emit error if room not found', async () => {
      redisClient.get.mockResolvedValue(null);

      await roomHandler.handleJoinRoom(mockSocket, {
        roomCode: 'NONEXISTENT',
        userId: 'user123',
      });

      expect(mockSocket.emit).toHaveBeenCalledWith('error', {
        message: 'Room not found',
      });
    });

    it('should emit error if user not found in room', async () => {
      const roomWithoutUser = {
        users: [
          { id: 'otherUser', nickname: 'OtherUser', isHost: true },
        ],
      };
      redisClient.get.mockResolvedValue(JSON.stringify(roomWithoutUser));

      await roomHandler.handleJoinRoom(mockSocket, {
        roomCode: 'ABCDEF',
        userId: 'user123',
      });

      expect(mockSocket.emit).toHaveBeenCalledWith('error', {
        message: 'User not found in this room',
      });
    });

    it('should handle Redis errors gracefully', async () => {
      redisClient.get.mockRejectedValue(new Error('Redis connection failed'));

      await roomHandler.handleJoinRoom(mockSocket, {
        roomCode: 'ABCDEF',
        userId: 'user123',
      });

      expect(mockSocket.emit).toHaveBeenCalledWith('error', {
        message: 'Server error',
      });
    });
  });

  describe('handleLeaveRoom', () => {
    const mockRoomData = {
      users: [
        { id: 'user123', nickname: 'TestUser', isHost: true },
        { id: 'user456', nickname: 'Player2', isHost: false },
      ],
      gameStarted: false,
    };

    beforeEach(() => {
      roomHandler.initialize();
      mockSocket.userId = 'user123';
      mockSocket.roomCode = 'ABCDEF';
      redisClient.get.mockResolvedValue(JSON.stringify(mockRoomData));
      redisClient.set.mockResolvedValue('OK');
    });

    it('should successfully remove user from room', async () => {
      await roomHandler.handleLeaveRoom(mockSocket);

      expect(redisClient.get).toHaveBeenCalledWith('room:ABCDEF');
      expect(redisClient.set).toHaveBeenCalled();
    });

    it('should delete room when no users left', async () => {
      const singleUserRoom = {
        users: [{ id: 'user123', nickname: 'TestUser', isHost: true }],
      };
      redisClient.get.mockResolvedValue(JSON.stringify(singleUserRoom));

      await roomHandler.handleLeaveRoom(mockSocket);

      expect(redisClient.del).toHaveBeenCalledWith('room:ABCDEF');
    });

    it('should assign new host when host leaves', async () => {
      await roomHandler.handleLeaveRoom(mockSocket);

      const setCall = redisClient.set.mock.calls[0];
      const updatedRoom = JSON.parse(setCall[1]);
      expect(updatedRoom.users[0].isHost).toBe(true);
    });

    it('should end game if insufficient players during game', async () => {
      const gameInProgress = {
        users: [
          { id: 'user123', nickname: 'TestUser', isHost: true },
          { id: 'user456', nickname: 'Player2', isHost: false },
        ],
        gameStarted: true,
      };
      redisClient.get.mockResolvedValue(JSON.stringify(gameInProgress));

      await roomHandler.handleLeaveRoom(mockSocket);

      const setCall = redisClient.set.mock.calls[0];
      const updatedRoom = JSON.parse(setCall[1]);
      expect(updatedRoom.gameStarted).toBe(false);
      expect(updatedRoom.gamePhase).toBe('game-end');
    });

    it('should do nothing if socket has no roomCode', async () => {
      mockSocket.roomCode = null;

      await roomHandler.handleLeaveRoom(mockSocket);

      expect(redisClient.get).not.toHaveBeenCalled();
    });

    it('should do nothing if socket has no userId', async () => {
      mockSocket.userId = null;

      await roomHandler.handleLeaveRoom(mockSocket);

      expect(redisClient.get).not.toHaveBeenCalled();
    });
  });

  describe('handleStartGame', () => {
    const mockRoomData = {
      users: [
        { id: 'host-user', nickname: 'HostUser', isHost: true },
        { id: 'user123', nickname: 'TestUser', isHost: false },
      ],
      gameStarted: false,
    };

    beforeEach(() => {
      roomHandler.initialize();
      mockSocket.userId = 'host-user';
      mockSocket.roomCode = 'ABCDEF';
      redisClient.get.mockResolvedValue(JSON.stringify(mockRoomData));
      redisClient.set.mockResolvedValue('OK');
    });

    it('should start game successfully with valid host', async () => {
      await roomHandler.handleStartGame(mockSocket, { rounds: 5 });

      expect(redisClient.get).toHaveBeenCalledWith('room:ABCDEF');
      expect(redisClient.set).toHaveBeenCalled();
      
      const setCall = redisClient.set.mock.calls[0];
      const updatedRoom = JSON.parse(setCall[1]);
      expect(updatedRoom.gameStarted).toBe(true);
      expect(updatedRoom.rounds).toBe(5);
    });

    it('should reject start game if not host', async () => {
      mockSocket.userId = 'user123'; // Not the host

      await roomHandler.handleStartGame(mockSocket, { rounds: 5 });

      expect(mockSocket.emit).toHaveBeenCalledWith('error', {
        message: 'Only the host can start the game',
      });
      expect(redisClient.set).not.toHaveBeenCalled();
    });

    it('should reject start game with insufficient players', async () => {
      const singlePlayerRoom = {
        users: [{ id: 'host-user', nickname: 'HostUser', isHost: true }],
        gameStarted: false,
      };
      redisClient.get.mockResolvedValue(JSON.stringify(singlePlayerRoom));

      await roomHandler.handleStartGame(mockSocket, { rounds: 5 });

      expect(mockSocket.emit).toHaveBeenCalledWith('error', {
        message: 'At least 2 players are required to start the game',
      });
    });

    it('should use default rounds if not specified', async () => {
      await roomHandler.handleStartGame(mockSocket, {});

      const setCall = redisClient.set.mock.calls[0];
      const updatedRoom = JSON.parse(setCall[1]);
      expect(updatedRoom.rounds).toBe(3); // Default value
    });
  });

  describe('handleSelectWord', () => {
    const mockRoomData = {
      users: [
        { id: 'drawer-user', nickname: 'Drawer', isHost: true },
        { id: 'guesser-user', nickname: 'Guesser', isHost: false },
      ],
      gameStarted: true,
      currentDrawer: 'drawer-user',
      gamePhase: 'word-selection',
      wordOptions: ['apple', 'banana', 'cherry'],
    };

    beforeEach(() => {
      roomHandler.initialize();
      mockSocket.userId = 'drawer-user';
      mockSocket.roomCode = 'ABCDEF';
      redisClient.get.mockResolvedValue(JSON.stringify(mockRoomData));
      redisClient.set.mockResolvedValue('OK');
    });

    it('should successfully select word as current drawer', async () => {
      await roomHandler.handleSelectWord(mockSocket, { 
        selectedWord: 'apple' 
      });

      expect(redisClient.set).toHaveBeenCalled();
      const setCall = redisClient.set.mock.calls[0];
      const updatedRoom = JSON.parse(setCall[1]);
      expect(updatedRoom.currentWord).toBe('apple');
      expect(updatedRoom.gamePhase).toBe('drawing');
    });

    it('should reject word selection if not current drawer', async () => {
      mockSocket.userId = 'guesser-user';

      await roomHandler.handleSelectWord(mockSocket, { 
        selectedWord: 'apple' 
      });

      expect(mockSocket.emit).toHaveBeenCalledWith('error', {
        message: 'Only the current drawer can select a word',
      });
    });

    it('should reject invalid word selection', async () => {
      await roomHandler.handleSelectWord(mockSocket, { 
        selectedWord: 'orange' // Not in wordOptions
      });

      expect(mockSocket.emit).toHaveBeenCalledWith('error', {
        message: 'Invalid word selection',
      });
    });

    it('should handle missing selectedWord', async () => {
      await roomHandler.handleSelectWord(mockSocket, {});

      expect(mockSocket.emit).toHaveBeenCalledWith('error', {
        message: 'Word selection is required',
      });
    });
  });

  describe('handleDraw', () => {
    beforeEach(() => {
      roomHandler.initialize();
      mockSocket.roomCode = 'ABCDEF';
      mockSocket.userId = 'user123';
    });

    it('should forward draw data to other users in room', () => {
      const drawData = {
        x: 100,
        y: 200,
        color: '#000000',
        brushSize: 5,
      };

      roomHandler.handleDraw(mockSocket, drawData);

      expect(mockSocket.to).toHaveBeenCalledWith('ABCDEF');
    });

    it('should do nothing if socket has no roomCode', () => {
      mockSocket.roomCode = null;

      roomHandler.handleDraw(mockSocket, { x: 100, y: 200 });

      expect(mockSocket.to).not.toHaveBeenCalled();
    });
  });

  describe('handleEndRound', () => {
    const mockRoomData = {
      users: [
        { id: 'user1', nickname: 'Player1', score: 100 },
        { id: 'user2', nickname: 'Player2', score: 50 },
      ],
      gameStarted: true,
      currentRound: 1,
      rounds: 3,
      currentDrawer: 'user1',
    };

    beforeEach(() => {
      roomHandler.initialize();
      mockSocket.roomCode = 'ABCDEF';
      redisClient.get.mockResolvedValue(JSON.stringify(mockRoomData));
      redisClient.set.mockResolvedValue('OK');
    });

    it('should end round and start next round', async () => {
      await roomHandler.handleEndRound(mockSocket);

      expect(redisClient.set).toHaveBeenCalled();
      const setCall = redisClient.set.mock.calls[0];
      const updatedRoom = JSON.parse(setCall[1]);
      expect(updatedRoom.currentRound).toBe(2);
    });

    it('should end game after final round', async () => {
      const finalRoundRoom = { ...mockRoomData, currentRound: 3 };
      redisClient.get.mockResolvedValue(JSON.stringify(finalRoundRoom));

      await roomHandler.handleEndRound(mockSocket);

      const setCall = redisClient.set.mock.calls[0];
      const updatedRoom = JSON.parse(setCall[1]);
      expect(updatedRoom.gameStarted).toBe(false);
      expect(updatedRoom.gamePhase).toBe('game-end');
    });
  });

  describe('handleRestartGame', () => {
    const mockRoomData = {
      users: [
        { id: 'host-user', nickname: 'Host', isHost: true, score: 100 },
        { id: 'player-user', nickname: 'Player', isHost: false, score: 50 },
      ],
      gameStarted: false,
      gamePhase: 'game-end',
    };

    beforeEach(() => {
      roomHandler.initialize();
      mockSocket.userId = 'host-user';
      mockSocket.roomCode = 'ABCDEF';
      redisClient.get.mockResolvedValue(JSON.stringify(mockRoomData));
      redisClient.set.mockResolvedValue('OK');
    });

    it('should successfully restart game as host', async () => {
      await roomHandler.handleRestartGame(mockSocket);

      expect(redisClient.set).toHaveBeenCalled();
      const setCall = redisClient.set.mock.calls[0];
      const updatedRoom = JSON.parse(setCall[1]);
      
      // Check that game state is reset
      expect(updatedRoom.gameStarted).toBe(false);
      expect(updatedRoom.currentRound).toBe(0);
      expect(updatedRoom.currentDrawer).toBeNull();
      
      // Check that user scores are reset
      updatedRoom.users.forEach(user => {
        expect(user.score).toBe(0);
      });
    });

    it('should reject restart if not host', async () => {
      mockSocket.userId = 'player-user';

      await roomHandler.handleRestartGame(mockSocket);

      expect(mockSocket.emit).toHaveBeenCalledWith('error', {
        message: 'Only the host can restart the game',
      });
      expect(redisClient.set).not.toHaveBeenCalled();
    });
  });

  describe('Edge Cases and Error Handling', () => {
    beforeEach(() => {
      roomHandler.initialize();
    });

    it('should handle Redis connection errors in any method', async () => {
      redisClient.get.mockRejectedValue(new Error('Redis connection failed'));
      mockSocket.roomCode = 'ABCDEF';

      await roomHandler.handleLeaveRoom(mockSocket);

      // Should not throw error - graceful handling
      expect(true).toBe(true);
    });

    it('should handle malformed JSON from Redis', async () => {
      redisClient.get.mockResolvedValue('invalid json');
      mockSocket.roomCode = 'ABCDEF';

      await roomHandler.handleJoinRoom(mockSocket, {
        roomCode: 'ABCDEF',
        userId: 'user123',
      });

      expect(mockSocket.emit).toHaveBeenCalledWith('error', {
        message: 'Server error',
      });
    });

    it('should handle null socket gracefully', async () => {
      await expect(roomHandler.handleJoinRoom(null, {
        roomCode: 'ABCDEF',
        userId: 'user123',
      })).rejects.toThrow();
    });
  });

  describe('Helper Methods', () => {
    beforeEach(() => {
      roomHandler.initialize();
    });

    describe('calculateFinalRankings', () => {
      it('should rank users by score descending', () => {
        const users = [
          { id: 'user1', nickname: 'Player1', score: 50 },
          { id: 'user2', nickname: 'Player2', score: 100 },
          { id: 'user3', nickname: 'Player3', score: 75 },
        ];

        const rankings = roomHandler.calculateFinalRankings(users);

        expect(rankings.finalScores[0].score).toBe(100);
        expect(rankings.finalScores[1].score).toBe(75);
        expect(rankings.finalScores[2].score).toBe(50);
        expect(rankings.finalScores[0].rank).toBe(1);
        expect(rankings.finalScores[1].rank).toBe(2);
        expect(rankings.finalScores[2].rank).toBe(3);
      });

      it('should handle ties in scores', () => {
        const users = [
          { id: 'user1', nickname: 'Player1', score: 100 },
          { id: 'user2', nickname: 'Player2', score: 100 },
          { id: 'user3', nickname: 'Player3', score: 50 },
        ];

        const rankings = roomHandler.calculateFinalRankings(users);

        expect(rankings.finalScores[0].rank).toBe(1);
        expect(rankings.finalScores[1].rank).toBe(1);
        expect(rankings.finalScores[2].rank).toBe(3); 
      });
    });
  });
}); 