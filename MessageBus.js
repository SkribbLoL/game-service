const amqp = require('amqplib');

class MessageBus {
  constructor() {
    this.connection = null;
    this.channel = null;
    this.gameService = null;
    this.exchanges = {
      gameEvents: 'game.events',
      gameRequests: 'game.requests',
      gameResponses: 'game.responses',
    };
    this.queues = {
      gameRequests: 'game.requests.queue',
      gameResponses: 'game.responses.queue',
    };
  }

  async initialize(gameService) {
    this.gameService = gameService;
    
    await this.connectWithRetry();
  }

  async connectWithRetry(maxRetries = 5, retryDelay = 5000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
        console.log(`Attempting RabbitMQ connection (attempt ${attempt}/${maxRetries})...`);
        
      // Connect to RabbitMQ
      const rabbitmqUrl = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
      this.connection = await amqp.connect(rabbitmqUrl);
      this.channel = await this.connection.createChannel();

      // Declare exchanges
      await this.channel.assertExchange(this.exchanges.gameEvents, 'topic', { durable: true });
      await this.channel.assertExchange(this.exchanges.gameRequests, 'direct', { durable: true });
      await this.channel.assertExchange(this.exchanges.gameResponses, 'direct', { durable: true });

      // Declare and bind request queue
      await this.channel.assertQueue(this.queues.gameRequests, { durable: true });
      await this.channel.bindQueue(this.queues.gameRequests, this.exchanges.gameRequests, 'game.request');

      // Consume requests from other services
      await this.channel.consume(this.queues.gameRequests, (msg) => {
        if (msg) {
          this.handleServiceRequest(msg);
        }
      }, { noAck: false });

      // Handle connection errors
      this.connection.on('error', (err) => {
        console.error('RabbitMQ connection error:', err);
      });

      this.connection.on('close', () => {
        console.log('RabbitMQ connection closed');
      });

      console.log('Game service message bus initialized with RabbitMQ');
        return; // Success, exit retry loop
        
    } catch (error) {
        console.error(`RabbitMQ connection attempt ${attempt} failed:`, error.message);
        
        if (attempt === maxRetries) {
          console.error('Failed to initialize RabbitMQ message bus after all retries');
      throw error;
        }
        
        console.log(`Retrying in ${retryDelay/1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
  }

  async handleServiceRequest(msg) {
    try {
      const request = JSON.parse(msg.content.toString());
      const { id, action, data, replyTo } = request;

      let response = { requestId: id, data: {} };

      switch (action) {
        case 'check-guess':
          response.data = await this.checkGuess(data);
          break;
        case 'get-current-drawer':
          response.data = await this.getCurrentDrawer(data);
          break;
        default:
          response.data = { error: 'Unknown action' };
      }

      // Send response back to the requesting service
      if (replyTo) {
        await this.channel.publish(
          this.exchanges.gameResponses,
          replyTo,
          Buffer.from(JSON.stringify(response)),
          { persistent: true }
        );
      }

      // Acknowledge message processing
      this.channel.ack(msg);
    } catch (error) {
      console.error('Error handling service request:', error);
      // Reject message and don't requeue
      this.channel.nack(msg, false, false);
    }
  }

  async checkGuess(data) {
    const { roomCode, userId, guess } = data;
    
    try {
      // Get room data from Redis
      const roomData = await this.gameService.redisClient.get(`room:${roomCode}`);
      if (!roomData) {
        return { isGameActive: false, isCorrect: false };
      }

      const room = JSON.parse(roomData);

      // Check if game is active and in drawing phase
      const isGameActive = room.gameStarted && room.gamePhase === 'drawing';
      
      if (!isGameActive) {
        return { isGameActive: false, isCorrect: false };
      }

      // Can't guess if you're the drawer
      if (room.currentDrawer === userId) {
        return { isGameActive: true, isCorrect: false };
      }

      // Check if guess is correct
      const isCorrect = guess.toLowerCase().trim() === room.currentWord.toLowerCase();

      if (isCorrect) {
        // Handle correct guess in game service
        await this.gameService.handleCorrectGuess(roomCode, userId, guess);
      }

      return { isGameActive: true, isCorrect };
    } catch (error) {
      console.error('Error checking guess:', error);
      return { isGameActive: false, isCorrect: false };
    }
  }

  async getCurrentDrawer(data) {
    const { roomCode } = data;
    
    try {
      // Get room data from Redis
      const roomData = await this.gameService.redisClient.get(`room:${roomCode}`);
      if (!roomData) {
        return { currentDrawer: null, gamePhase: 'unknown' };
      }

      const room = JSON.parse(roomData);

      return {
        currentDrawer: room.currentDrawer,
        gamePhase: room.gamePhase || 'unknown',
        gameStarted: room.gameStarted || false,
      };
    } catch (error) {
      console.error('Error getting current drawer:', error);
      return { currentDrawer: null, gamePhase: 'unknown' };
    }
  }

  // Publish game events to other services
  async publishGameEvent(type, roomCode, data = {}) {
    try {
      const event = {
        type,
        roomCode,
        data,
        timestamp: Date.now(),
      };

      const routingKey = `game.event.${type}`;
      
      await this.channel.publish(
        this.exchanges.gameEvents,
        routingKey,
        Buffer.from(JSON.stringify(event)),
        { persistent: true }
      );

      console.log(`Published game event: ${type} for room ${roomCode}`);
    } catch (error) {
      console.error('Error publishing game event:', error);
    }
  }

  async close() {
    try {
      if (this.channel) {
        await this.channel.close();
      }
      if (this.connection) {
        await this.connection.close();
      }
    } catch (error) {
      console.error('Error closing RabbitMQ connection:', error);
    }
  }
}

module.exports = MessageBus; 