import { Crawler } from './crawler.js';
import db from '../db/database.js';

class JobQueue {
  constructor() {
    this.isProcessing = false;
    this.activeCrawlers = new Map();
  }

  async processQueue(io) {
    if (this.isProcessing) return;
    
    // Find next queued job
    const job = db.prepare('SELECT * FROM job_queue WHERE status = ? ORDER BY created_at ASC LIMIT 1').get('queued');
    if (!job) return;

    this.isProcessing = true;
    
    // Mark as running
    db.prepare('UPDATE job_queue SET status = ?, started_at = CURRENT_TIMESTAMP WHERE id = ?').run('running', job.id);
    db.prepare('UPDATE clones SET status = ? WHERE id = ?').run('crawling', job.clone_id);
    
    const cloneRecord = db.prepare('SELECT * FROM clones WHERE id = ?').get(job.clone_id);
    
    io.emit('clone-status', { id: job.clone_id, status: 'crawling' });

    try {
      const crawler = new Crawler(cloneRecord, io);
      this.activeCrawlers.set(job.clone_id, crawler);
      await crawler.start();
      
      db.prepare('UPDATE job_queue SET status = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?').run('completed', job.id);
      db.prepare('UPDATE clones SET status = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?').run('completed', job.clone_id);
      io.emit('clone-status', { id: job.clone_id, status: 'completed' });
    } catch (error) {
      console.error('Crawl job failed:', error);
      db.prepare('UPDATE job_queue SET status = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?').run('failed', job.id);
      db.prepare('UPDATE clones SET status = ?, error_message = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?').run('failed', error.message, job.clone_id);
      io.emit('clone-status', { id: job.clone_id, status: 'failed', error: error.message });
    } finally {
      this.activeCrawlers.delete(job.clone_id);
      this.isProcessing = false;
      // Process next job
      setTimeout(() => this.processQueue(io), 1000);
    }
  }

  addJob(cloneId, io) {
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO job_queue (id, clone_id) VALUES (?, ?)').run(id, cloneId);
    // Start processing if not already
    this.processQueue(io);
  }

  stopJob(cloneId) {
    const crawler = this.activeCrawlers.get(cloneId);
    if (crawler) {
      crawler.stop();
      return true;
    }
    return false;
  }
}

export const jobQueue = new JobQueue();
