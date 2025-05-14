/**
 * Tests for RoomSocketHandler.js
 */

// Mock dependencies
jest.mock('../RedisSingleton', () => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn()
}));

jest.mock('../SocketSingleton', () => ({
  getIO: jest.fn()
}));

const redisClient = require('../RedisSingleton');
const socketInstance = require('../SocketSingleton');
const roomHandler = require('../socket-handlers/RoomSocketHandler');

describe('RoomSocketHandler Tests', () => {
  let mockIo;
  let mockSocket;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create mock socket.io instance
    mockIo = {
      on: jest.fn(),
      to: jest.fn().mockReturnThis(),
      emit: jest.fn()
    };

    // Mock socket instance
    mockSocket = {
      id: 'socket123',
      userId: 'user123',
      roomCode: 'ABCDEF',
      join: jest.fn(),
      leave: jest.fn(),
      emit: jest.fn(),
      on: jest.fn()
    };

    // Mock socketInstance.getIO to return our mock
    socketInstance.getIO.mockReturnValue(mockIo);

    // Set the io property on the roomHandler
    roomHandler.io = mockIo;
  });

  test('should initialize and set up event handlers', () => {
    // Act
    roomHandler.initialize();

    // Assert
    expect(socketInstance.getIO).toHaveBeenCalled();
    expect(mockIo.on).toHaveBeenCalledWith('connection', expect.any(Function));
  });

  test('should handle join room successfully', async () => {
    // Arrange
    const roomData = {
      code: 'ABCDEF',
      name: 'Test Room',
      users: [
        { id: 'user123', nickname: 'TestUser', isHost: true }
      ]
    };

    // Mock Redis response
    redisClient.get.mockResolvedValue(JSON.stringify(roomData));

    // Act
    await roomHandler.handleJoinRoom(mockSocket, { roomCode: 'ABCDEF', userId: 'user123' });

    // Assert
    expect(redisClient.get).toHaveBeenCalledWith('room:ABCDEF');
    expect(mockSocket.join).toHaveBeenCalledWith('ABCDEF');
    expect(mockSocket.emit).toHaveBeenCalledWith('room-joined', { room: roomData });
  });

  test('should handle join room error when room not found', async () => {
    // Arrange
    redisClient.get.mockResolvedValue(null);

    // Act
    await roomHandler.handleJoinRoom(mockSocket, { roomCode: 'NONEXISTENT', userId: 'user123' });

    // Assert
    expect(mockSocket.emit).toHaveBeenCalledWith('error', { message: 'Room not found' });
  });

  test('should handle leave room successfully', async () => {
    // Arrange
    const roomData = {
      code: 'ABCDEF',
      name: 'Test Room',
      users: [
        { id: 'user123', nickname: 'TestUser', isHost: true },
        { id: 'user456', nickname: 'OtherUser', isHost: false }
      ]
    };

    // Set up socket with room data
    mockSocket.roomCode = 'ABCDEF';
    mockSocket.userId = 'user123';

    // Mock Redis response
    redisClient.get.mockResolvedValue(JSON.stringify(roomData));

    // Act
    await roomHandler.handleLeaveRoom(mockSocket);

    // Assert
    expect(redisClient.get).toHaveBeenCalledWith('room:ABCDEF');
    expect(redisClient.set).toHaveBeenCalledWith(
      'room:ABCDEF',
      expect.any(String),
      'EX',
      expect.any(Number)
    );
    expect(mockSocket.leave).toHaveBeenCalledWith('ABCDEF');

    // Verify that the user was removed and new host assigned
    const updatedRoomString = redisClient.set.mock.calls[0][1];
    const updatedRoom = JSON.parse(updatedRoomString);
    expect(updatedRoom.users.length).toBe(1);
    expect(updatedRoom.users[0].id).toBe('user456');
    expect(updatedRoom.users[0].isHost).toBe(true);
  });

  test('should handle start game successfully', async () => {
    // Arrange
    const roomData = {
      code: 'ABCDEF',
      name: 'Test Room',
      users: [
        { id: 'user123', nickname: 'TestUser', isHost: true },
        { id: 'user456', nickname: 'OtherUser', isHost: false }
      ],
      gameStarted: false
    };

    // Set up socket with room data
    mockSocket.roomCode = 'ABCDEF';
    mockSocket.userId = 'user123';

    // Mock Redis response
    redisClient.get.mockResolvedValue(JSON.stringify(roomData));

    // Set Math.random to return a predictable value for testing
    const originalRandom = Math.random;
    Math.random = jest.fn().mockReturnValue(0.1);

    // Act
    await roomHandler.handleStartGame(mockSocket, { rounds: 5 });

    // Restore Math.random
    Math.random = originalRandom;

    // Assert
    expect(redisClient.get).toHaveBeenCalledWith('room:ABCDEF');
    expect(redisClient.set).toHaveBeenCalledWith(
      'room:ABCDEF',
      expect.any(String),
      'EX',
      expect.any(Number)
    );

    // Verify that the game started
    const updatedRoomString = redisClient.set.mock.calls[0][1];
    const updatedRoom = JSON.parse(updatedRoomString);
    expect(updatedRoom.gameStarted).toBe(true);
    expect(updatedRoom.rounds).toBe(5);
    expect(updatedRoom.currentRound).toBe(1);
    expect(mockIo.to).toHaveBeenCalledWith('ABCDEF');
    expect(mockIo.emit).toHaveBeenCalledWith('game-started', expect.objectContaining({
      message: 'Game started!'
    }));
  });
}); 