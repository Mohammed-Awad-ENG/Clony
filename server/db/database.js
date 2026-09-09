import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure the db directory exists
const dbDir = path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(path.join(dbDir, 'clony.db'));
db.pragma('journal_mode = WAL');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS clones (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    domain TEXT NOT NULL,
    title TEXT,
    favicon TEXT,
    status TEXT DEFAULT 'pending',
    pages_found INTEGER DEFAULT 0,
    pages_downloaded INTEGER DEFAULT 0,
    assets_downloaded INTEGER DEFAULT 0,
    total_size_bytes INTEGER DEFAULT 0,
    directory TEXT NOT NULL,
    error_message TEXT,
    options TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME
  );

  CREATE TABLE IF NOT EXISTS pages (
    id TEXT PRIMARY KEY,
    clone_id TEXT NOT NULL REFERENCES clones(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    local_path TEXT NOT NULL,
    title TEXT,
    status_code INTEGER,
    content_type TEXT,
    size_bytes INTEGER,
    depth INTEGER DEFAULT 0,
    parent_url TEXT
  );

  CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    clone_id TEXT NOT NULL REFERENCES clones(id) ON DELETE CASCADE,
    original_url TEXT NOT NULL,
    local_path TEXT NOT NULL,
    hash TEXT NOT NULL,
    content_type TEXT,
    size_bytes INTEGER
  );

  CREATE TABLE IF NOT EXISTS job_queue (
    id TEXT PRIMARY KEY,
    clone_id TEXT NOT NULL REFERENCES clones(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'queued',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    started_at DATETIME,
    completed_at DATETIME
  );

  CREATE TABLE IF NOT EXISTS clone_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clone_id TEXT NOT NULL REFERENCES clones(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    status TEXT NOT NULL,
    percentage INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

export default db;
