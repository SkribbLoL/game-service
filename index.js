const express = require('express');
const cors = require('cors');
const http = require('http');
const socketSingleton = require('./SocketSingleton');
const MessageBus = require('./MessageBus');
// Initialize Redis connection
const redisClient = require('./RedisSingleton');

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

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Start the server
(async () => {
  try {
    console.log('🚀 Starting Game Service initialization...');
    
    // Initialize message bus
    console.log('📦 Initializing Message Bus...');
    const messageBus = new MessageBus();
    
    // Create a game service object for message bus
    const gameService = {
      redisClient,
      handleCorrectGuess:
        roomSocketHandler.handleCorrectGuess.bind(roomSocketHandler),
    };
    
    await messageBus.initialize(gameService);
    console.log('✅ Message Bus initialized');

    // Initialize socket handlers with message bus
    console.log('🔌 Initializing Socket Handlers...');
    roomSocketHandler.initialize(messageBus);
    drawingSocketHandler.initialize();
    console.log('✅ Socket Handlers initialized');

    // Log errors better
    process.on('unhandledRejection', (error) => {
      console.error('💥 Unhandled Promise Rejection:', error);
    });

    process.on('uncaughtException', (error) => {
      console.error('💥 Uncaught Exception:', error);
    });

    server.listen(port, () => {
      console.log(`✅ Game service running on http://localhost:${port}`);
      console.log('🎉 Game Service fully initialized and ready!');
    });
  } catch (error) {
    console.error('💥 Error in game service initialization:', error);
    process.exit(1);
  }
})();
