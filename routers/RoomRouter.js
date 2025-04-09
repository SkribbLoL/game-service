const router = require('express').Router();
const redisClient = require('../RedisSingleton');
const { nanoid } = require('nanoid');


// Example route to get all rooms
router.get('/', async (req, res) => {
    const key = req.body.key;
    if (!key) {
        return res.status(400).json({ error: 'Key is required' });
    }
    console.log(key);
    const room = await redisClient.get(key);
    if (!room) {
        return res.status(404).json({ error: 'Room not found' });
    }
    console.log(room);
    res.json({ message: 'Get all rooms',  room});
});
// Example route to create a new room
router.post('/', async (req, res) => {
    const { nickname } = req.body;
    if (!nickname) {
        return res.status(400).json({ error: ' Nickname is required' });
    }
    const roomCode = nanoid(6);
    const roomData = {
        users: [],
        createdAt: Date.now(),
        gameStarted: false
    }
    console.log(game_url);
    // Here you would typically save the room to a database
    res.status(201).json({ message: `Room ${name} created successfully` });

    // const roomCode = nanoid(6); // like "a8b9z1"
    // const roomData = {
    //     users: [],
    //     createdAt: Date.now(),
    //     gameStarted: false
    // };
    
    await redis.set(`room:${roomCode}`, JSON.stringify(roomData), 'EX', ROOM_TTL_SECONDS);
    
    res.json({ roomCode, joinUrl: `https://yourgame.com/room/${roomCode}` });
});

// Example route to get a specific room by ID
router.get('/:id', (req, res) => {
    const { id } = req.params;
    res.json({ message: `Get room with ID: ${id}` });
});

// Example route to delete a room by ID
router.delete('/:id', (req, res) => {
    const { id } = req.params;
    res.json({ message: `Room with ID: ${id} deleted successfully` });
});

module.exports = router;