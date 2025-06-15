// redis-client.js
const Redis = require('ioredis');
let instance = null;

class RedisClient {
  constructor() {
    if (instance) {
      return instance;
    }

    this.client = new Redis({
      // Kubernetes/Helm configuration
      host: process.env.REDIS_HOST || 'redis-master.default.svc.cluster.local',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD,
      
      // Docker Compose configuration (commented out)
      // Uncomment below and comment above for Docker Compose usage
      // host: process.env.REDIS_HOST || 'redis',
      // port: process.env.REDIS_PORT || 6379,
      // password: undefined, // No password for Docker Compose Redis
    });
    // console.log(
    //   'Redis client initialized with host:',
    //   process.env.REDIS_HOST,
    //   'port:',
    //   process.env.REDIS_PORT,
    //   'password:',
    //   process.env.REDIS_PASSWORD
    // );

    // Handle connection events
    this.client.on('error', (err) => console.error('Redis error:', err));
    this.client.on('connect', () => console.log('Connected to Redis'));

    instance = this;
  }

  async get(key) {
    return this.client.get(key);
  }

  async set(key, value, expiryFlag, expiryTime) {
    console.log('Key: ' + key, 'Value: ' + value);
    if (expiryFlag && expiryTime) {
      return this.client.set(key, value, expiryFlag, expiryTime);
    }
    return this.client.set(key, value);
  }

  async del(key) {
    return this.client.del(key);
  }

  // Add other Redis methods you need
}

module.exports = new RedisClient();
