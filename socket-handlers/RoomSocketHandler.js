const redisClient = require('../RedisSingleton');
const socketInstance = require('../SocketSingleton');

// Constants
const ROOM_TTL_SECONDS = 3600; // 1 hour TTL for rooms

class RoomSocketHandler {
  constructor() {
    this.io = null;
  }

  /**
   * Initialize the socket handlers
   */
  initialize() {
    this.io = socketInstance.getIO();
    this.setupEventHandlers();
    console.log('Room socket handlers initialized');
  }

  /**
   * Setup socket event handlers for room functionality
   */
  setupEventHandlers() {
    this.io.on('connection', (socket) => {
      console.log(`User connected: ${socket.id}`);

      // Room events
      socket.on('join-room', (data) => this.handleJoinRoom(socket, data));
      socket.on('leave-room', () => this.handleLeaveRoom(socket));
      socket.on('start-game', (data) => this.handleStartGame(socket, data));
      socket.on('chat-message', (data) => this.handleChatMessage(socket, data));

      // Handle disconnections
      socket.on('disconnect', () => this.handleLeaveRoom(socket));
    });
  }

  /**
   * Handle joining a room
   * @param {Object} socket - Socket instance
   * @param {Object} data - Room join data
   */
  async handleJoinRoom(socket, data) {
    try {
      const { roomCode, userId } = data;

      if (!roomCode || !userId) {
        return socket.emit('error', {
          message: 'Room code and user ID are required',
        });
      }

      // Get room data from Redis
      const roomData = await redisClient.get(`room:${roomCode}`);
      if (!roomData) {
        return socket.emit('error', { message: 'Room not found' });
      }

      const room = JSON.parse(roomData);

      // Check if user exists in the room
      const userExists = room.users.find((user) => user.id === userId);
      if (!userExists) {
        return socket.emit('error', { message: 'User not found in this room' });
      }

      // Associate socket with user ID and room
      socket.userId = userId;
      socket.roomCode = roomCode;

      // Join socket.io room
      socket.join(roomCode);

      // Let everyone know someone joined
      this.io.to(roomCode).emit('user-joined', {
        user: userExists,
        users: room.users,
        message: `${userExists.nickname} joined the room`,
      });

      // Send room data to the user who just joined
      socket.emit('room-joined', { room });

      console.log(`User ${userId} joined room ${roomCode}`);
    } catch (error) {
      console.error('Error joining room via socket:', error);
      socket.emit('error', { message: 'Server error' });
    }
  }

  /**
   * Handle leaving a room
   * @param {Object} socket - Socket instance
   */
  async handleLeaveRoom(socket) {
    try {
      const { roomCode, userId } = socket;

      if (!roomCode || !userId) return;

      // Get room data from Redis
      const roomData = await redisClient.get(`room:${roomCode}`);
      if (!roomData) return;

      const room = JSON.parse(roomData);

      // Find user in room
      const userIndex = room.users.findIndex((user) => user.id === userId);
      if (userIndex === -1) return;

      const user = room.users[userIndex];

      // Remove user from room
      room.users.splice(userIndex, 1);

      // If no users left, delete the room
      if (room.users.length === 0) {
        await redisClient.del(`room:${roomCode}`);
        console.log(`Room ${roomCode} deleted - no users left`);
        return;
      }

      // If the host left, assign a new host
      if (user.isHost && room.users.length > 0) {
        room.users[0].isHost = true;
      }

      // Update room in Redis
      await redisClient.set(
        `room:${roomCode}`,
        JSON.stringify(room),
        'EX',
        ROOM_TTL_SECONDS
      );

      // Notify remaining users
      this.io.to(roomCode).emit('user-left', {
        userId,
        users: room.users,
        message: `${user.nickname} left the room`,
      });

      console.log(`User ${userId} left room ${roomCode}`);

      // Leave the socket.io room
      socket.leave(roomCode);
    } catch (error) {
      console.error('Error handling leave room:', error);
    }
  }

  /**
   * Handle starting a game
   * @param {Object} socket - Socket instance
   * @param {Object} data - Game settings data
   */
  async handleStartGame(socket, data) {
    try {
      const { roomCode } = socket;

      if (!roomCode) {
        return socket.emit('error', { message: 'Not in a room' });
      }

      // Get room data
      const roomData = await redisClient.get(`room:${roomCode}`);
      if (!roomData) {
        return socket.emit('error', { message: 'Room not found' });
      }

      const room = JSON.parse(roomData);

      // Find user
      const user = room.users.find((u) => u.id === socket.userId);

      // Only host can start the game
      if (!user || !user.isHost) {
        return socket.emit('error', {
          message: 'Only the host can start the game',
        });
      }

      // Minimum players check
      if (room.users.length < 2) {
        return socket.emit('error', {
          message: 'Need at least 2 players to start',
        });
      }

      // Start the game
      room.gameStarted = true;
      room.rounds = data.rounds || 3;
      room.currentRound = 1;

      // Select first drawer randomly
      const randomIndex = Math.floor(Math.random() * room.users.length);
      room.currentDrawer = room.users[randomIndex].id;

      // Update room in Redis
      await redisClient.set(
        `room:${roomCode}`,
        JSON.stringify(room),
        'EX',
        ROOM_TTL_SECONDS
      );

      // Notify all players
      this.io.to(roomCode).emit('game-started', {
        room,
        message: 'Game started!',
      });

      console.log(`Game started in room ${roomCode}`);
    } catch (error) {
      console.error('Error starting game:', error);
      socket.emit('error', { message: 'Server error' });
    }
  }

  /**
   * Handle chat messages
   * @param {Object} socket - Socket instance
   * @param {Object} data - Message data
   */
  async handleChatMessage(socket, data) {
    try {
      const { roomCode, userId } = socket;
      const { message } = data;

      if (!roomCode || !message) return;

      // Get room data
      const roomData = await redisClient.get(`room:${roomCode}`);
      if (!roomData) return;

      const room = JSON.parse(roomData);

      // Find user
      const user = room.users.find((u) => u.id === userId);
      if (!user) return;

      // Send message to all users in the room
      this.io.to(roomCode).emit('chat-message', {
        userId,
        nickname: user.nickname,
        message,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('Error sending chat message:', error);
    }
  }
}

module.exports = new RoomSocketHandler();
