import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import cors from 'cors';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*', // For development
  }
});

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ensure clones directory exists
const clonesDir = path.join(__dirname, '..', 'clones');
if (!fs.existsSync(clonesDir)) {
  fs.mkdirSync(clonesDir, { recursive: true });
}

// Reset any stuck jobs on startup
import db from './db/database.js';
db.prepare('UPDATE job_queue SET status = ? WHERE status = ?').run('failed', 'running');
db.prepare('UPDATE clones SET status = ?, error_message = ? WHERE status = ?').run('failed', 'Server restarted during crawl', 'crawling');

// Socket.IO for real-time progress
io.on('connection', (socket) => {
  console.log('A client connected');
  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

// Pass IO to req for routes to emit events
app.use((req, res, next) => {
  req.io = io;
  next();
});

// Catch absolute asset requests from cloned iframes (like Next.js /_next/ or absolute /images/)
app.use((req, res, next) => {
  const referer = req.headers.referer;
  // Guard against redirect loops or redirecting API calls
  if (referer && !req.path.startsWith('/api/') && !req.originalUrl.startsWith('/api/preview/')) {
    const match = referer.match(/\/api\/preview\/([a-f0-9\-]+)\//);
    if (match) {
      const uuid = match[1];
      return res.redirect(`/api/preview/${uuid}${req.originalUrl}`);
    }
  }
  next();
});

import cloneRoutes from './routes/clone.js';
import exportRoutes from './routes/export.js';
import previewRoutes from './routes/preview.js';
app.use('/api/clones', cloneRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/preview', previewRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Clony backend is running' });
});

httpServer.listen(PORT, '127.0.0.1', () => {
  console.log(`Clony backend server running on http://127.0.0.1:${PORT}`);
});
