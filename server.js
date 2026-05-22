const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const outputDir = path.join(__dirname, 'outputs');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
}

const activeStreamPath = path.join(outputDir, 'active_stream.webm');
let writeStream = null;

io.on('connection', (socket) => {
  console.log(`[+] User connected: ${socket.id}`);

  socket.on('video-chunk', (data) => {
    if (!writeStream) {
      console.log('[i] Starting active broadcast...');
      writeStream = fs.createWriteStream(activeStreamPath);
    }
    writeStream.write(data);
  });

  socket.on('make-reel', () => {
    console.log(`[i] Reel triggered by ${socket.id}`);

    if (!fs.existsSync(activeStreamPath)) {
      socket.emit('reel-error', {
        message: 'No active stream found!'
      });
      return;
    }

    const reelPath = path.join(outputDir, `reel_${Date.now()}.mp4`);

    ffmpeg(activeStreamPath)
      .videoFilters(['crop=ih*9/16:ih'])
      .outputOptions('-c:v libx264')
      .save(reelPath)
      .on('end', () => {
        console.log(`[+] Reel created: ${reelPath}`);
        io.emit('reel-ready', {
          message: 'New Reel generated successfully!'
        });
      })
      .on('error', (err) => {
        console.error('[!] FFmpeg Error:', err.message);
      });
  });

  socket.on('disconnect', () => {
    console.log(`[-] User disconnected: ${socket.id}`);
  });
});

server.listen(5000, '0.0.0.0', () => {
  console.log('Backend running on http://localhost:5000');
});

