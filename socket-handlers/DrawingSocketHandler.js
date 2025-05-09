const socketInstance = require('../SocketSingleton');
const redisClient = require('../RedisSingleton');

class DrawingSocketHandler {
  constructor() {
    this.io = null;
  }

  /**
   * Initialize the socket handlers
   */
  initialize() {
    this.io = socketInstance.getIO();
    this.setupEventHandlers();
    console.log('Drawing socket handlers initialized');
  }

  /**
   * Setup socket event handlers for drawing functionality
   */
  setupEventHandlers() {
    this.io.on('connection', (socket) => {
      // Drawing events
      socket.on('draw', (data) => this.handleDraw(socket, data));
      socket.on('clear-canvas', (data) => this.handleClearCanvas(socket));
      socket.on('change-color', (data) => this.handleChangeColor(socket, data));
      socket.on('change-tool', (data) => this.handleChangeTool(socket, data));
    });
  }

  /**
   * Handle drawing events
   * @param {Object} socket - Socket instance
   * @param {Object} data - Drawing data
   */
  handleDraw(socket, data) {
    const { roomCode, userId } = socket;
    
    if (!roomCode) return;
    
    // Check if user is the current drawer (should be done in a full implementation)
    
    // Forward drawing data to everyone except sender
    socket.to(roomCode).emit('draw-update', {
      ...data,
      userId
    });
  }

  /**
   * Handle canvas clearing
   * @param {Object} socket - Socket instance
   */
  handleClearCanvas(socket) {
    const { roomCode, userId } = socket;
    
    if (!roomCode) return;
    
    // Notify everyone in the room that canvas was cleared
    socket.to(roomCode).emit('canvas-cleared', {
      userId,
      timestamp: Date.now()
    });
  }

  /**
   * Handle color change events
   * @param {Object} socket - Socket instance
   * @param {Object} data - Color data
   */
  handleChangeColor(socket, data) {
    const { roomCode, userId } = socket;
    const { color } = data;
    
    if (!roomCode || !color) return;
    
    // Notify everyone in the room about color change (optional)
    socket.to(roomCode).emit('color-changed', {
      userId,
      color,
      timestamp: Date.now()
    });
  }

  /**
   * Handle drawing tool change events
   * @param {Object} socket - Socket instance
   * @param {Object} data - Tool data
   */
  handleChangeTool(socket, data) {
    const { roomCode, userId } = socket;
    const { tool, size } = data;
    
    if (!roomCode || !tool) return;
    
    // Notify everyone in the room about tool change (optional)
    socket.to(roomCode).emit('tool-changed', {
      userId,
      tool,
      size,
      timestamp: Date.now()
    });
  }
}

module.exports = new DrawingSocketHandler(); 