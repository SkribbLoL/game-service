// redis-client.js
const Redis = require('ioredis');
let instance = null;

class RedisClient {
  constructor() {
    if (instance) {
      return instance;
    }
    
    this.client = new Redis({
      host: process.env.REDIS_HOST || 'redis',
      port: process.env.REDIS_PORT || 6379,
      // Add other options as needed
    });
    
    // Handle connection events
    this.client.on('error', (err) => console.error('Redis error:', err));
    this.client.on('connect', () => console.log('Connected to Redis'));
    
    instance = this;
  }
  
  async get(key) {
    return this.client.get(key);
  }
  
  async set(key, value) {
    console.log('Key' + key, 'Value' + value);
    return this.client.set(key, value);
  }
  
  // Add other Redis methods you need
}

module.exports = new RedisClient();