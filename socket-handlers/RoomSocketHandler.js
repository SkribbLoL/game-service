const redisClient = require('../RedisSingleton');
const socketInstance = require('../SocketSingleton');
const { getRandomWords, calculateWordPoints } = require('../words');

// Constants
const ROOM_TTL_SECONDS = 3600; // 1 hour TTL for rooms

class RoomSocketHandler {
  constructor() {
    this.io = null;
    this.redisClient = null;
    this.roundTimers = new Map(); // Track active round timers
    this.messageBus = null; // Will be injected
  }

  /**
   * Initialize the socket handlers
   */
  initialize(messageBus = null) {
    this.io = socketInstance.getIO();
    this.messageBus = messageBus;
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
      
      // Game events
      socket.on('select-word', (data) => this.handleSelectWord(socket, data));
      socket.on('end-round', (data) => this.handleEndRound(socket, data));
      socket.on('restart-game', (data) => this.handleRestartGame(socket, data));

      // Drawing events
      socket.on('draw', (drawData) => this.handleDraw(socket, drawData));

      // Handle disconnections
      socket.on('disconnect', () => this.handleLeaveRoom(socket));
    });
  }

  /**
   * Handle drawing events
   * @param {Object} socket - Socket instance
   * @param {Object} drawData - Drawing data
   */
  handleDraw(socket, drawData) {
    const { roomCode, userId } = socket;

    if (!roomCode) return;

    // Forward drawing data to everyone except sender
    socket.to(roomCode).emit('draw-update', {
      ...drawData,
      userId,
    });
  }

  /**
   * Handle joining a room
   * @param {Object} socket - Socket instance
   * @param {Object} data - Room join data
   */
  async handleJoinRoom(socket, data) {
    try {
      console.log('🎯 handleJoinRoom called with:', data);
      console.log('🔍 Socket ID:', socket.id);
      
      const { roomCode, userId } = data;

      if (!roomCode || !userId) {
        console.log('❌ Missing roomCode or userId');
        return socket.emit('error', {
          message: 'Room code and user ID are required',
        });
      }

      console.log('🔍 Looking for room:', roomCode);
      // Get room data from Redis
      const roomData = await redisClient.get(`room:${roomCode}`);
      if (!roomData) {
        console.log('❌ Room not found in Redis');
        return socket.emit('error', { message: 'Room not found' });
      }

      const room = JSON.parse(roomData);
      console.log('✅ Room found:', room);

      // Check if user exists in the room
      const userExists = room.users.find((user) => user.id === userId);
      if (!userExists) {
        console.log('❌ User not found in room');
        return socket.emit('error', { message: 'User not found in this room' });
      }

      console.log('✅ User found in room:', userExists);

      // Associate socket with user ID and room
      socket.userId = userId;
      socket.roomCode = roomCode;

      // Join socket.io room
      socket.join(roomCode);
      console.log('✅ Socket joined room:', roomCode);

      // Let everyone know someone joined
      this.io.to(roomCode).emit('user-joined', {
        user: userExists,
        users: room.users,
        message: `${userExists.nickname} joined the room`,
      });
      console.log('📢 Emitted user-joined to room');

      // Send room data to the user who just joined
      socket.emit('room-joined', { room });
      console.log('📢 Emitted room-joined to user:', userId);

      console.log(`✅ User ${userId} successfully joined room ${roomCode}`);
    } catch (error) {
      console.error('💥 Error joining room via socket:', error);
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

      // Check if game should end due to insufficient players
      if (room.gameStarted && room.users.length < 2) {
        // End the game immediately due to insufficient players
        room.gameStarted = false;
        room.gamePhase = 'game-end';
        room.currentDrawer = null;
        room.currentWord = null;
        room.wordOptions = null;
        room.roundStartTime = null;
        room.roundEndTime = null;

        // Clear any existing round timer
        if (this.roundTimers.has(roomCode)) {
          clearTimeout(this.roundTimers.get(roomCode));
          this.roundTimers.delete(roomCode);
        }

        // Calculate winner from remaining players (if any)
        const sortedUsers = room.users.sort((a, b) => b.score - a.score);
        const winner =
          sortedUsers.length > 0
            ? sortedUsers[0]
            : { nickname: 'No one', score: 0 };

        // Update room in Redis first
        await redisClient.set(
          `room:${roomCode}`,
          JSON.stringify(room),
          'EX',
          ROOM_TTL_SECONDS
        );

        // Notify remaining users that the game ended due to insufficient players
        this.io.to(roomCode).emit('game-ended', {
          room,
          winner,
          finalScores: sortedUsers,
          message: `Game ended due to insufficient players. ${winner.nickname} wins!`,
        });

        // Notify about user leaving
        this.io.to(roomCode).emit('user-left', {
          userId,
          users: room.users,
          message: `${user.nickname} left the room - Game ended due to insufficient players`,
        });

        console.log(
          `Game ended in room ${roomCode} due to insufficient players after ${user.nickname} left`
        );
      } else {
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
      }

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

      // Extract settings with defaults
      const settings = {
        rounds: data.rounds || 3,
        maxPlayers: data.maxPlayers || 10,
        roundDuration: data.roundDuration || 60
      };

      // Minimum players check
      if (room.users.length < 2) {
        return socket.emit('error', {
          message: 'Need at least 2 players to start',
        });
      }

      // Check if current players exceed max setting
      if (room.users.length > settings.maxPlayers) {
        return socket.emit('error', {
          message: `Too many players. Max allowed: ${settings.maxPlayers}`,
        });
      }

      // Reset all user scores to 0 for the new game
      room.users.forEach((user) => {
        user.score = 0;
      });

      // Start the game
      room.gameStarted = true;
      room.rounds = settings.rounds;
      room.maxPlayers = settings.maxPlayers;
      room.roundDuration = settings.roundDuration;
      room.currentRound = 1;

      // Select first drawer randomly
      const randomIndex = Math.floor(Math.random() * room.users.length);
      room.currentDrawer = room.users[randomIndex].id;
      
      // Initialize game state
      room.currentWord = null;
      room.wordOptions = null;
      room.roundStartTime = null;
      room.roundEndTime = null;
      room.gamePhase = 'word-selection'; // word-selection, drawing, round-end

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
        message: `Game started! ${settings.rounds} rounds, ${settings.roundDuration}s per round`,
      });

      // Notify chat service that game started
      if (this.messageBus) {
        await this.messageBus.publishGameEvent('game-started', roomCode, {
          settings,
          message: 'Game started! Your messages will be treated as guesses.'
        });
      }

      // Send word options to the drawer
      await this.sendWordOptionsToDrawer(roomCode, room.currentDrawer);

      console.log(`Game started in room ${roomCode} with settings:`, settings);
    } catch (error) {
      console.error('Error starting game:', error);
      socket.emit('error', { message: 'Server error' });
    }
  }

  /**
   * Send word options to the current drawer
   * @param {string} roomCode - Room code
   * @param {string} drawerId - ID of the drawer
   */
  async sendWordOptionsToDrawer(roomCode, drawerId) {
    try {
      // Get 3 random words
      const wordOptions = getRandomWords(3, 'mixed');
      
      // Store word options in room data
      const roomData = await redisClient.get(`room:${roomCode}`);
      if (!roomData) return;
      
      const room = JSON.parse(roomData);
      room.wordOptions = wordOptions;
      
      await redisClient.set(
        `room:${roomCode}`,
        JSON.stringify(room),
        'EX',
        ROOM_TTL_SECONDS
      );

      // Find the drawer's socket and send word options
      const drawerSocket = [...this.io.sockets.sockets.values()]
        .find((s) => s.userId === drawerId && s.roomCode === roomCode);

      if (drawerSocket) {
        drawerSocket.emit('word-options', {
          words: wordOptions,
          message: 'Choose a word to draw!',
        });
      }

      console.log(`Sent word options to drawer ${drawerId} in room ${roomCode}:`, wordOptions);
    } catch (error) {
      console.error('Error sending word options:', error);
    }
  }

  /**
   * Handle word selection by the drawer
   * @param {Object} socket - Socket instance
   * @param {Object} data - Selected word data
   */
  async handleSelectWord(socket, data) {
    try {
      const { roomCode, userId } = socket;
      const { selectedWord } = data;

      if (!roomCode || !selectedWord) {
        return socket.emit('error', { message: 'Invalid word selection' });
      }

      // Get room data
      const roomData = await redisClient.get(`room:${roomCode}`);
      if (!roomData) {
        return socket.emit('error', { message: 'Room not found' });
      }

      const room = JSON.parse(roomData);

      // Verify user is the current drawer
      if (room.currentDrawer !== userId) {
        return socket.emit('error', { message: 'Only the current drawer can select a word' });
      }

      // Verify the word was in the options
      if (!room.wordOptions || !room.wordOptions.includes(selectedWord)) {
        return socket.emit('error', { message: 'Invalid word selection' });
      }

      // Update room with selected word
      room.currentWord = selectedWord;
      room.gamePhase = 'drawing';
      room.roundStartTime = Date.now();
      room.roundEndTime = Date.now() + (room.roundDuration * 1000); // Convert seconds to milliseconds
      room.wordOptions = null; // Clear options after selection

      // Update room in Redis
      await redisClient.set(
        `room:${roomCode}`,
        JSON.stringify(room),
        'EX',
        ROOM_TTL_SECONDS
      );

      // Create word display for guessers (blanks)
      const wordDisplay = selectedWord.replace(/[a-zA-Z]/g, '_');

      // Notify all players that drawing phase has started
      this.io.to(roomCode).emit('word-selected', {
        room,
        wordDisplay,
        roundDuration: room.roundDuration,
        roundEndTime: room.roundEndTime,
        message: `${room.users.find(u => u.id === userId)?.nickname || 'Player'} is now drawing!`
      });

      // Send the actual word only to the drawer
      socket.emit('drawer-word', {
        word: selectedWord,
        message: `You are drawing: ${selectedWord}`
      });

      // Notify drawing service about word selection
      if (this.messageBus) {
        await this.messageBus.publishGameEvent('word-selected', roomCode, {
          drawerId: userId,
          word: selectedWord
        });
      }

      // Clear any existing timer for this room
      if (this.roundTimers.has(roomCode)) {
        clearTimeout(this.roundTimers.get(roomCode));
      }

      // Set a timer to end the round automatically
      const roundTimer = setTimeout(() => {
        this.handleEndRound(socket, { auto: true, reason: 'time-up' });
      }, room.roundDuration * 1000);
      
      // Store the timer reference
      this.roundTimers.set(roomCode, roundTimer);

      console.log(`Word "${selectedWord}" selected by drawer ${userId} in room ${roomCode}`);
    } catch (error) {
      console.error('Error handling word selection:', error);
      socket.emit('error', { message: 'Server error' });
    }
  }

  /**
   * Handle correct guess (called by message bus)
   * @param {string} roomCode - Room code
   * @param {string} userId - User ID who guessed correctly
   * @param {string} guess - The correct guess
   */
  async handleCorrectGuess(roomCode, userId, guess) {
    try {
      // Get room data
      const roomData = await redisClient.get(`room:${roomCode}`);
      if (!roomData) return;

      const room = JSON.parse(roomData);
      const user = room.users.find(u => u.id === userId);
      if (!user) return;

      // Award points to the guesser
      const points = calculateWordPoints(room.currentWord);
      user.score += points;

      // Award points to the drawer (half of guesser's points)
      const drawerPoints = Math.floor(points / 2);
      const drawer = room.users.find((u) => u.id === room.currentDrawer);
      if (drawer) {
        drawer.score += drawerPoints;
      }

      // Update room
      await redisClient.set(
        `room:${roomCode}`,
        JSON.stringify(room),
        'EX',
        ROOM_TTL_SECONDS
      );

      // Notify everyone of correct guess
      this.io.to(roomCode).emit('correct-guess', {
        userId,
        username: user.nickname,
        word: room.currentWord,
        points,
        totalScore: user.score,
        drawerPoints,
        drawerScore: drawer?.score || 0,
        message: `${user.nickname} guessed "${room.currentWord}" correctly! (+${points} points, ${drawer?.nickname} gets +${drawerPoints} points)`
      });

      // Notify chat service about correct guess
      if (this.messageBus) {
        await this.messageBus.publishGameEvent('correct-guess', roomCode, {
          userId,
          username: user.nickname,
          word: room.currentWord,
          points,
          totalScore: user.score
        });
      }

      // End the round after a short delay
      setTimeout(() => {
        this.handleEndRound({ roomCode }, { auto: true });
      }, 2000);

    } catch (error) {
      console.error('Error handling correct guess:', error);
    }
  }

  /**
   * Handle ending the current round
   * @param {Object} socket - Socket instance
   * @param {Object} data - End round data
   */
  async handleEndRound(socket, data = {}) {
    try {
      const { roomCode } = socket;

      if (!roomCode) return;

      // Get room data
      const roomData = await redisClient.get(`room:${roomCode}`);
      if (!roomData) return;

      const room = JSON.parse(roomData);

      // Check if this is the last round
      const isLastRound = room.currentRound >= room.rounds;

      if (isLastRound) {
        // End the entire game
        room.gamePhase = 'game-end';
        room.gameStarted = false;

        // Calculate final scores and winner
        const sortedUsers = room.users.sort((a, b) => b.score - a.score);
        const winner = sortedUsers[0];

        // Update room in Redis
        await redisClient.set(
          `room:${roomCode}`,
          JSON.stringify(room),
          'EX',
          ROOM_TTL_SECONDS
        );

        // Notify everyone that the game has ended
        this.io.to(roomCode).emit('game-ended', {
          room,
          winner,
          finalScores: sortedUsers,
          message: `Game ended! Winner: ${winner.nickname} with ${winner.score} points!`
        });

        // Notify chat service that game ended
        if (this.messageBus) {
          await this.messageBus.publishGameEvent('game-ended', roomCode, {
            winner,
            finalScores: sortedUsers,
            message: 'Game ended! Back to chat mode.'
          });
        }

        // Clear the canvas for game end
        this.io.to(roomCode).emit('clear-canvas-game-end', { roomCode });

        // Clean up round timer
        if (this.roundTimers.has(roomCode)) {
          clearTimeout(this.roundTimers.get(roomCode));
          this.roundTimers.delete(roomCode);
        }

        console.log(`Game ended in room ${roomCode}. Winner: ${winner.nickname} (${winner.score} points)`);
      } else {
        // Clear any existing timer for this room
        if (this.roundTimers.has(roomCode)) {
          clearTimeout(this.roundTimers.get(roomCode));
          this.roundTimers.delete(roomCode);
        }

        // Start next round
        room.currentRound += 1;
        room.gamePhase = 'word-selection';
        room.currentWord = null;
        room.wordOptions = null;
        room.roundStartTime = null;
        room.roundEndTime = null;

        // Select next drawer (rotate through players)
        const currentDrawerIndex = room.users.findIndex(u => u.id === room.currentDrawer);
        const nextDrawerIndex = (currentDrawerIndex + 1) % room.users.length;
        room.currentDrawer = room.users[nextDrawerIndex].id;

        // Update room in Redis
        await redisClient.set(
          `room:${roomCode}`,
          JSON.stringify(room),
          'EX',
          ROOM_TTL_SECONDS
        );

        // Notify all players about the new round
        this.io.to(roomCode).emit('new-round', {
          room,
          message: `Round ${room.currentRound}/${room.rounds} starting! ${room.users[nextDrawerIndex].nickname}'s turn to draw.`
        });

        // Clear the canvas for the new round
        this.io.to(roomCode).emit('clear-canvas-round', { roomCode });

        // Notify drawing service about new round
        if (this.messageBus) {
          await this.messageBus.publishGameEvent('round-started', roomCode, {
            drawerId: room.currentDrawer,
            round: room.currentRound
          });
        }

        // Send word options to the new drawer
        await this.sendWordOptionsToDrawer(roomCode, room.currentDrawer);

        console.log(`Round ${room.currentRound} started in room ${roomCode}. New drawer: ${room.users[nextDrawerIndex].nickname}`);
      }
    } catch (error) {
      console.error('Error ending round:', error);
    }
  }

  /**
   * Handle restarting a game
   * @param {Object} socket - Socket instance
   * @param {Object} data - Restart game data
   */
  async handleRestartGame(socket, data = {}) {
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

      // Only host can restart the game
      if (!user || !user.isHost) {
        return socket.emit('error', {
          message: 'Only the host can restart the game',
        });
      }

      // Reset game state
      room.gameStarted = false;
      room.gamePhase = 'waiting';
      room.currentRound = 0;
      room.rounds = 3; // Default rounds
      room.currentDrawer = null;
      room.currentWord = null;
      room.wordOptions = null;
      room.roundStartTime = null;
      room.roundEndTime = null;
      room.maxPlayers = 10; // Default max players
      room.roundDuration = 60; // Default round duration

      // Reset all user scores to 0
      room.users.forEach((user) => {
        user.score = 0;
      });

      // Update room in Redis
      await redisClient.set(
        `room:${roomCode}`,
        JSON.stringify(room),
        'EX',
        ROOM_TTL_SECONDS
      );

      // Clean up any existing round timer
      if (this.roundTimers.has(roomCode)) {
        clearTimeout(this.roundTimers.get(roomCode));
        this.roundTimers.delete(roomCode);
      }

      // Notify all players that the game has been restarted
      this.io.to(roomCode).emit('game-restarted', {
        room,
        message: 'Game restarted! Waiting for host to configure settings and start a new game.'
      });

      console.log(`Game restarted in room ${roomCode} by host ${user.nickname}`);
    } catch (error) {
      console.error('Error restarting game:', error);
      socket.emit('error', { message: 'Server error' });
    }
  }
}

module.exports = new RoomSocketHandler();