const express = require('express');
const cors = require('cors');
const http = require('http');
const socketSingleton = require('./SocketSingleton');
// Initialize Redis connection
require('./RedisSingleton');

// Import socket handlers
const roomSocketHandler = require('./socket-handlers/RoomSocketHandler');
const drawingSocketHandler = require('./socket-handlers/DrawingSocketHandler');

const app = express();
const server = http.createServer(app);
const port = process.env.PORT || 5000;

// Load router
const roomRouter = require('./routers/RoomRouter');

// Middleware
app.use(cors());
app.use(express.json());
app.use('/rooms', roomRouter);

// Initialize Socket.io singleton
socketSingleton.setup(server);

// Initialize socket handlers
roomSocketHandler.initialize();
drawingSocketHandler.initialize();

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Start the server
(async () => {
  try {
    // Log errors better
    process.on('unhandledRejection', (error) => {
      console.error('Unhandled Promise Rejection:', error);
    });

    server.listen(port, () => {
      console.log(`Game service running on http://localhost:${port}`);
    });
  } catch (error) {
    console.log('Error in game service', error);
  }
})();
