const router = require('express').Router();
const redisClient = require('../RedisSingleton');
const { nanoid } = require('nanoid');

// Constants
const ROOM_TTL_SECONDS = 3600; // 1 hour TTL for rooms

// Route to get a specific room by code
router.get('/:roomCode', async (req, res) => {
  const { roomCode } = req.params;

  try {
    const roomData = await redisClient.get(`room:${roomCode}`);
    if (!roomData) {
      return res.status(404).json({ error: 'Room not found' });
    }

    const room = JSON.parse(roomData);
    return res.json({ roomCode, room });
  } catch (error) {
    console.error('Error getting room:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Route to create a new room
router.post('/', async (req, res) => {
  const { nickname } = req.body;

  if (!nickname) {
    return res.status(400).json({ error: 'Nickname is required' });
  }

  try {
    // 🔥 ARTIFICIAL CPU WORK FOR HPA TESTING 🔥
    // This is intentionally inefficient to force CPU usage
    let cpuWorkResult = 0;
    for (let i = 0; i < 100000; i++) {
      cpuWorkResult += Math.sqrt(Math.random() * 1000) * Math.sin(i / 1000);
      if (i % 10000 === 0) {
        // Force some string operations
        const tempStr = Math.random().toString(36).repeat(10);
        cpuWorkResult += tempStr.length;
      }
    }

    // More CPU work: JSON parsing/stringifying
    const dummyData = Array(50)
      .fill(0)
      .map((_, idx) => ({
        id: idx,
        value: Math.random().toString(36),
        nested: Array(10)
          .fill(0)
          .map(() => Math.random() * 1000),
      }));

    for (let j = 0; j < 5; j++) {
      const stringified = JSON.stringify(dummyData);
      const parsed = JSON.parse(stringified);
      cpuWorkResult += parsed.length;
    }
    
    // Use the result to prevent optimization
    if (cpuWorkResult < 0) {
      console.log('Impossible condition:', cpuWorkResult);
    }
    // 🔥 END ARTIFICIAL CPU WORK 🔥

    const roomCode = nanoid(6).toUpperCase(); // Generate uppercase code for readability

    // Create a new user with a unique ID
    const userId = nanoid(10);
    const user = {
      id: userId,
      nickname,
      isHost: true,
      score: 0,
      joinedAt: Date.now(),
    };

    // Create room data structure
    const roomData = {
      users: [user],
      createdAt: Date.now(),
      gameStarted: false,
      rounds: 0,
      currentRound: 0,
      currentDrawer: null,
    };

    // Store in Redis with expiration
    await redisClient.set(
      `room:${roomCode}`,
      JSON.stringify(roomData),
      'EX',
      ROOM_TTL_SECONDS
    );

    return res.status(201).json({
      roomCode,
      userId,
      joinUrl: `/room/${roomCode}`,
    });
  } catch (error) {
    console.error('Error creating room:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Route to join a room
router.post('/:roomCode/join', async (req, res) => {
  const { roomCode } = req.params;
  const { nickname } = req.body;

  if (!nickname) {
    return res.status(400).json({ error: 'Nickname is required' });
  }

  try {
    // Get room data from Redis
    const roomData = await redisClient.get(`room:${roomCode}`);
    if (!roomData) {
      return res.status(404).json({ error: 'Room not found' });
    }

    const room = JSON.parse(roomData);

    // Check if game already started
    if (room.gameStarted) {
      return res.status(400).json({ error: 'Game already in progress' });
    }

    // Check if nickname is already taken in this room
    if (room.users.some((user) => user.nickname === nickname)) {
      return res
        .status(400)
        .json({ error: 'Nickname already taken in this room' });
    }

    // Create a new user
    const userId = nanoid(10);
    const newUser = {
      id: userId,
      nickname,
      isHost: false,
      score: 0,
      joinedAt: Date.now(),
    };

    // Add user to room
    room.users.push(newUser);

    // Update room in Redis
    await redisClient.set(
      `room:${roomCode}`,
      JSON.stringify(room),
      'EX',
      ROOM_TTL_SECONDS
    );

    return res.status(200).json({
      roomCode,
      userId,
      room,
    });
  } catch (error) {
    console.error('Error joining room:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Route to delete a room
router.delete('/:roomCode', async (req, res) => {
  const { roomCode } = req.params;

  try {
    const roomExists = await redisClient.get(`room:${roomCode}`);
    if (!roomExists) {
      return res.status(404).json({ error: 'Room not found' });
    }

    await redisClient.del(`room:${roomCode}`);
    return res.json({ message: `Room ${roomCode} deleted successfully` });
  } catch (error) {
    console.error('Error deleting room:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
