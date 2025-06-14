const socketIO = require('socket.io');
let instance = null;

/**
 * Socket.io Singleton to maintain a single instance across the application
 */
class SocketSingleton {
  constructor() {
    if (instance) {
      return instance;
    }

    // Don't initialize the server here - we'll do that when setup is called
    this.io = null;
    instance = this;
  }

  /**
   * Initialize Socket.io with the HTTP server
   * @param {Object} server - HTTP server instance
   */
  setup(server) {
    if (this.io) {
      console.log('Socket.io already initialized');
      return this.io;
    }

    this.io = socketIO(server, {
      cors: {
        origin: '*', // In production, restrict this to your frontend URL
        methods: ['GET', 'POST'],
      },
      path: '/socket.io/',
      allowEIO3: true,
    });

    console.log('Socket.io initialized');
    return this.io;
  }

  /**
   * Get the Socket.io instance
   * @returns {Object} Socket.io instance
   */
  getIO() {
    if (!this.io) {
      throw new Error('Socket.io not initialized. Call setup() first.');
    }
    return this.io;
  }
}

module.exports = new SocketSingleton();
