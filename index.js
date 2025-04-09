const express = require('express');
const cors = require('cors');
const { createClient } = require('redis');

const app = express();
const port = 5000;

// Redis setup
const client = createClient({ url: 'redis://redis:6379' }); // use your docker host name

client.on('error', (err) => console.log('Redis Client Error', err));

// Load router
const roomRouter = require('./routers/RoomRouter'); // change .ts to .js if you're not using TypeScript

app.use(cors());
app.use(express.json());
app.use("/rooms", roomRouter);

(async () => {
  try {
    await client.connect(); // connect to Redis

    // Attach Redis to app locals (optional, for access in routes)
    app.locals.redis = client;
    client.on('error', err => console.log('Redis Client Error', err));

    app.listen(port, () => {
      console.log(`Game service running on http://localhost:${port}`);
    });

  } catch (error) {
    console.log("Error in game service", error);
  }
})();
