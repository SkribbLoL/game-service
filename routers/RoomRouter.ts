const router = require('express').Router();

// Example route to get all rooms
router.get('/', (req, res) => {
    res.json({ message: 'Get all rooms' });
});

// Example route to create a new room
router.post('/', (req, res) => {
    const { name } = req.body;
    if (!name) {
        return res.status(400).json({ error: 'Room name is required' });
    }
    res.status(201).json({ message: `Room '${name}' created successfully` });
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

export default router;