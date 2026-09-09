import express from 'express';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import db from '../db/database.js';
import { jobQueue } from '../services/jobQueue.js';
import { getDomain } from '../utils/urlUtils.js';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clonesBaseDir = path.join(__dirname, '..', '..', 'clones');

// Start a new clone job
router.post('/', (req, res) => {
  const { url, options } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    new URL(url); // Validate URL
  } catch (e) {
    return res.status(400).json({ error: 'Invalid URL format' });
  }

  const id = crypto.randomUUID();
  const domain = getDomain(url);
  const directory = path.join(clonesBaseDir, id);

  try {
    db.prepare(`
      INSERT INTO clones (id, url, domain, options, directory)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, url, domain, JSON.stringify(options || {}), directory);

    // Add to queue
    jobQueue.addJob(id, req.io);

    res.status(201).json({ id, message: 'Clone job created and queued' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to create clone job' });
  }
});

// List all clones
router.get('/', (req, res) => {
  try {
    const clones = db.prepare('SELECT * FROM clones ORDER BY created_at DESC').all();
    res.json(clones);
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch clones' });
  }
});

// Get clone details
router.get('/:id', (req, res) => {
  try {
    const clone = db.prepare('SELECT * FROM clones WHERE id = ?').get(req.params.id);
    if (!clone) return res.status(404).json({ error: 'Clone not found' });

    const pages = db.prepare('SELECT * FROM pages WHERE clone_id = ?').all(req.params.id);
    const assets = db.prepare('SELECT content_type, COUNT(*) as count, SUM(size_bytes) as size FROM assets WHERE clone_id = ? GROUP BY content_type').all(req.params.id);

    res.json({ clone, pages, assets });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch clone details' });
  }
});

// Get clone logs
router.get('/:id/logs', (req, res) => {
  try {
    const logs = db.prepare('SELECT * FROM clone_logs WHERE clone_id = ? ORDER BY created_at ASC').all(req.params.id);
    res.json(logs);
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch clone logs' });
  }
});

// Stop a clone job (cancel)
router.post('/:id/stop', (req, res) => {
  try {
    const success = jobQueue.stopJob(req.params.id);
    if (success) {
      res.json({ message: 'Stop signal sent successfully. Crawler will halt after current page finishes.' });
    } else {
      res.status(404).json({ error: 'Clone is not currently crawling or not found.' });
    }
  } catch (e) {
    res.status(500).json({ error: 'Failed to stop clone job' });
  }
});

// Delete a clone
router.delete('/:id', (req, res) => {
  try {
    // Delete from DB (cascade deletes pages and assets)
    db.prepare('DELETE FROM clones WHERE id = ?').run(req.params.id);
    
    // Delete files
    const dir = path.join(clonesBaseDir, req.params.id);
    import('fs').then(fs => {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete clone' });
  }
});

export default router;
