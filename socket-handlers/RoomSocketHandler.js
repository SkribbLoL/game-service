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
      console.log(`🎯 User connected to game service: ${socket.id}`);
      console.log(`🔍 Socket handshake:`, socket.handshake);

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
      socket.on('disconnect', (reason) => {
        console.log(`🔌 User disconnected from game service: ${socket.id}, reason: ${reason}`);
        this.handleLeaveRoom(socket);
      });

      // Handle connection errors
      socket.on('error', (error) => {
        console.error(`💥 Socket error for ${socket.id}:`, error);
      });
    });

    // Handle Socket.IO server errors
    this.io.on('error', (error) => {
      console.error('💥 Socket.IO server error:', error);
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

        // Calculate rankings from remaining players (if any) with tie handling
        let rankings;
        if (room.users.length > 0) {
          rankings = this.calculateFinalRankings(room.users);
        } else {
          rankings = {
            winners: [{ nickname: 'No one', score: 0 }],
            finalScores: [],
            message: 'Game ended due to insufficient players. No winner.',
          };
        }

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
          winners: rankings.winners,
          winner: rankings.winners[0], // Keep backward compatibility
          finalScores: rankings.finalScores,
          message: `Game ended due to insufficient players. ${
            rankings.winners.length === 1 &&
            rankings.winners[0].nickname !== 'No one'
              ? `${rankings.winners[0].nickname} wins!`
              : rankings.message
          }`,
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
      console.log(
        `🎯 sendWordOptionsToDrawer called for drawer ${drawerId} in room ${roomCode}`
      );

      // Get 3 random words
      const wordOptions = getRandomWords(3, 'mixed');
      console.log(`📝 Generated word options:`, wordOptions);

      // Store word options in room data
      const roomData = await redisClient.get(`room:${roomCode}`);
      if (!roomData) {
        console.log('❌ Room data not found in Redis');
        return;
      }

      const room = JSON.parse(roomData);
      room.wordOptions = wordOptions;

      await redisClient.set(
        `room:${roomCode}`,
        JSON.stringify(room),
        'EX',
        ROOM_TTL_SECONDS
      );
      console.log('✅ Word options stored in Redis');

      // Debug: Log all connected sockets (namespace version)
      const allSockets = this.io.sockets; // For namespaces, use this.io.sockets directly
      console.log(`🔍 Total connected sockets: ${allSockets.size}`);
      
      // Convert Map to Array to iterate
      const socketArray = Array.from(allSockets.values());
      socketArray.forEach((socket, index) => {
        console.log(
          `   Socket ${index}: id=${socket.id}, userId=${socket.userId}, roomCode=${socket.roomCode}`
        );
      });

      // Find the drawer's socket and send word options (namespace version)
      const drawerSocket = socketArray.find(
        (s) => s.userId === drawerId && s.roomCode === roomCode
      );

      if (drawerSocket) {
        console.log(`✅ Found drawer socket: ${drawerSocket.id}`);
        drawerSocket.emit('word-options', {
          words: wordOptions,
          message: 'Choose a word to draw!',
        });
        console.log(`📤 Sent word-options event to drawer ${drawerId}`);
      } else {
        console.log(
          `❌ Drawer socket not found for drawer ${drawerId} in room ${roomCode}`
        );
        console.log(`🔍 Looking for: userId=${drawerId}, roomCode=${roomCode}`);
      }

      console.log(
        `Sent word options to drawer ${drawerId} in room ${roomCode}:`,
        wordOptions
      );
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
        message: `You are drawing: ${selectedWord}`,
      });

      // Notify drawing service about word selection (async, don't wait)
      if (this.messageBus) {
        this.messageBus.publishGameEvent('word-selected', roomCode, {
          drawerId: userId,
          word: selectedWord,
        }).catch(err => console.log('Drawing service notification failed:', err.message));
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

      // Check if this will be the last round after ending
      const isLastRound = room.currentRound >= room.rounds;

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
        isLastRound,
        message: `🎉 ${user.nickname} got it! The word was "${room.currentWord}" (+${points} pts)${drawer ? `, ${drawer.nickname} gets +${drawerPoints} pts` : ''}`,
      });

      // Notify chat service about correct guess with detailed points (async, don't wait)
      if (this.messageBus) {
        this.messageBus.publishGameEvent('correct-guess', roomCode, {
          userId,
          username: user.nickname,
          word: room.currentWord,
          points,
          totalScore: user.score,
          drawerPoints,
          drawerScore: drawer?.score || 0,
          message: `Points awarded: ${user.nickname} +${points} pts, ${drawer?.nickname} +${drawerPoints} pts`,
        }).catch(err => console.log('Chat service notification failed:', err.message));
      }

      // End the round after a 5 second delay to let players see the result
      setTimeout(() => {
        this.handleEndRound({ roomCode }, { auto: true });
      }, 5000);

    } catch (error) {
      console.error('Error handling correct guess:', error);
    }
  }

  /**
   * Calculate final rankings with proper tie handling
   * @param {Array} users - Array of user objects with scores
   * @returns {Object} Object with winners array and formatted ranking message
   */
  calculateFinalRankings(users) {
    // Sort users by score (highest first)
    const sortedUsers = users.sort((a, b) => b.score - a.score);
    
    // Group users by score to handle ties
    const scoreGroups = {};
    sortedUsers.forEach(user => {
      if (!scoreGroups[user.score]) {
        scoreGroups[user.score] = [];
      }
      scoreGroups[user.score].push(user);
    });

    // Get unique scores in descending order
    const uniqueScores = Object.keys(scoreGroups)
      .map(score => parseInt(score))
      .sort((a, b) => b - a);

    // Determine winners (all players with the highest score)
    const highestScore = uniqueScores[0];
    const winners = scoreGroups[highestScore];

    // Create message based on tie situation
    let message;
    if (winners.length === 1) {
      message = `Game ended! Winner: ${winners[0].nickname} with ${highestScore} points!`;
    } else if (winners.length === users.length) {
      // Everyone tied
      const winnerNames = winners.map(w => w.nickname).join(', ');
      message = `Game ended! It's a tie! Everyone scored ${highestScore} points: ${winnerNames}`;
    } else {
      // Some players tied for first place
      const winnerNames = winners.map(w => w.nickname).join(', ');
      message = `Game ended! It's a tie for 1st place with ${highestScore} points: ${winnerNames}`;
    }

    return {
      winners,
      finalScores: sortedUsers,
      message
    };
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

        // Calculate final rankings with proper tie handling
        const rankings = this.calculateFinalRankings(room.users);

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
          winners: rankings.winners,
          winner: rankings.winners[0], // Keep backward compatibility
          finalScores: rankings.finalScores,
          message: rankings.message,
        });

        // Notify chat service that game ended
        if (this.messageBus) {
          this.messageBus.publishGameEvent('game-ended', roomCode, {
            winners: rankings.winners,
            winner: rankings.winners[0], // Keep backward compatibility
            finalScores: rankings.finalScores,
            message: 'Game ended! Back to chat mode.',
          }).catch(err => console.log('Chat service notification failed:', err.message));
        }

        // Clear the canvas for game end
        this.io.to(roomCode).emit('clear-canvas-game-end', { roomCode });

        // Clean up round timer
        if (this.roundTimers.has(roomCode)) {
          clearTimeout(this.roundTimers.get(roomCode));
          this.roundTimers.delete(roomCode);
        }

        console.log(`Game ended in room ${roomCode}. Winner: ${rankings.winners[0].nickname} (${rankings.winners[0].score} points)`);
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
          message: `Round ${room.currentRound}/${room.rounds} starting! ${room.users[nextDrawerIndex].nickname}'s turn to draw.`,
        });

        // Clear the canvas for the new round
        this.io.to(roomCode).emit('clear-canvas-round', { roomCode });

        // Notify chat service about new round to clear chat
        if (this.messageBus) {
          this.messageBus.publishGameEvent('new-round', roomCode, {
            round: room.currentRound,
            drawerId: room.currentDrawer,
            message: 'New round started! Chat cleared.',
          }).catch(err => console.log('Chat service new round notification failed:', err.message));
        }

        // Notify drawing service about new round
        if (this.messageBus) {
          this.messageBus.publishGameEvent('round-started', roomCode, {
            drawerId: room.currentDrawer,
            round: room.currentRound,
          }).catch(err => console.log('Drawing service notification failed:', err.message));
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
        message: 'Game restarted! Waiting for host to configure settings and start a new game.',
      });

      // Notify chat service that game restarted to clear chat
      if (this.messageBus) {
        this.messageBus.publishGameEvent('game-restarted', roomCode, {
          message: 'Game restarted! Chat cleared.',
        }).catch(err => console.log('Chat service game-restarted notification failed:', err.message));
      }

      // Notify drawing service that game restarted to clear canvas
      if (this.messageBus) {
        this.messageBus.publishGameEvent('game-restarted', roomCode, {
          message: 'Game restarted! Canvas cleared.',
        }).catch(err => console.log('Drawing service game-restarted notification failed:', err.message));
      }

      // Clear the canvas for game restart
      this.io.to(roomCode).emit('clear-canvas-game-end', { roomCode });

      console.log(`Game restarted in room ${roomCode} by host ${user.nickname}`);
    } catch (error) {
      console.error('Error restarting game:', error);
      socket.emit('error', { message: 'Server error' });
    }
  }
}

module.exports = new RoomSocketHandler();