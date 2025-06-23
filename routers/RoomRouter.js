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

// 🔥 STRESS TEST ROUTE FOR HPA TESTING 🔥
router.post('/stress-test', async (req, res) => {
  const { intensity = 100000 } = req.body;

  try {
    const startTime = Date.now();
    let cpuWorkResult = 0;

    // HEAVY CPU WORK - Math operations
    for (let i = 0; i < intensity; i++) {
      cpuWorkResult +=
        Math.sqrt(Math.random() * 1000) *
        Math.sin(i / 1000) *
        Math.cos(i / 500);

      if (i % 10000 === 0) {
        // String operations
        const tempStr = Math.random().toString(36).repeat(20);
        cpuWorkResult += tempStr.split('').reverse().join('').length;

        // Array operations
        const tempArray = Array(100)
          .fill(0)
          .map(() => Math.random() * 1000);
        cpuWorkResult += tempArray.reduce((sum, val) => sum + val, 0) / 1000;
      }

      if (i % 25000 === 0) {
        // Heavy JSON operations
        const complexObj = {
          timestamp: Date.now(),
          data: Array(50)
            .fill(0)
            .map((_, idx) => ({
              id: idx,
              value: Math.random().toString(36),
              nested: {
                level1: Array(20)
                  .fill(0)
                  .map(() => Math.random()),
                level2: Math.random().toString(36).repeat(10),
              },
            })),
        };

        // Serialize and parse multiple times
        for (let j = 0; j < 10; j++) {
          const serialized = JSON.stringify(complexObj);
          const parsed = JSON.parse(serialized);
          cpuWorkResult += parsed.data.length;
        }
      }
    }

    // More intensive operations
    const bigArray = Array(1000)
      .fill(0)
      .map(() => Math.random());
    bigArray.sort();
    cpuWorkResult += bigArray[0];

    // Hash-like operations
    let hashWork = '';
    for (let k = 0; k < 1000; k++) {
      hashWork += Math.random().toString(36).substring(2, 15);
    }
    cpuWorkResult += hashWork.length;

    const endTime = Date.now();
    const duration = endTime - startTime;

    // Use the result to prevent optimization
    const finalResult = Math.round(cpuWorkResult);

    return res.status(200).json({
      message: 'Stress test completed successfully',
      duration: `${duration}ms`,
      intensity: intensity,
      result: finalResult,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error in stress test:', error);
    return res.status(500).json({ error: 'Stress test failed' });
  }
});

module.exports = router;
