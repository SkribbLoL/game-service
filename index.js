const express = require('express');
const cors = require('cors');

const roomRouter = require('./routers/RoomRouter');
const app = express();

const port = 5000;

app.use(cors());
app.use(express.json());
app.use("/room", roomRouter);

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`);
});

import { createClient } from 'redis';

const client = createClient();

client.on('error', err => console.log('Redis Client Error', err));

await client.connect();