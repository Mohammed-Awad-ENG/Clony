import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { fileTypeFromBuffer } from 'file-type';
import mime from 'mime-types';
import db from '../db/database.js';
import { ensureDirSync } from '../utils/fileUtils.js';

const MAX_ASSET_SIZE = 50 * 1024 * 1024; // 50MB

export class AssetStore {
  constructor(cloneId, cloneDir) {
    this.cloneId = cloneId;
    this.cloneDir = cloneDir;
    this.assetsDir = path.join(this.cloneDir, '_assets');
    ensureDirSync(this.assetsDir);
    this.pendingDownloads = new Map();
  }

  async processAsset(url, buffer, responseHeaders) {
    if (buffer.length > MAX_ASSET_SIZE) {
      console.log(`Skipping large asset: ${url}`);
      return null;
    }

    const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);
    
    // Check if we already have this asset in the DB for this clone
    const existingAsset = db.prepare('SELECT local_path FROM assets WHERE clone_id = ? AND hash = ?').get(this.cloneId, hash);
    
    if (existingAsset) {
      return existingAsset.local_path;
    }

    // Determine extension
    let ext = path.extname(new URL(url).pathname);
    let contentType = responseHeaders['content-type'] || '';
    
    if (!ext) {
      const type = await fileTypeFromBuffer(buffer);
      if (type) {
        ext = '.' + type.ext;
      } else if (contentType) {
        const mimeExt = mime.extension(contentType.split(';')[0]);
        if (mimeExt) ext = '.' + mimeExt;
      }
    }
    
    if (!ext) ext = '.bin';

    let prefix = '_assets';
    if (url.includes('/_next/')) {
      prefix = path.join('_assets', '_next');
      ensureDirSync(path.join(this.cloneDir, prefix));
    }

    const filename = `${hash}${ext}`;
    const localPath = path.join(prefix, filename);
    const absolutePath = path.join(this.cloneDir, localPath);

    fs.writeFileSync(absolutePath, buffer);

    db.prepare(`
      INSERT INTO assets (id, clone_id, original_url, local_path, hash, content_type, size_bytes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), this.cloneId, url, localPath, hash, contentType, buffer.length);

    // Update clone stats
    db.prepare('UPDATE clones SET assets_downloaded = assets_downloaded + 1, total_size_bytes = total_size_bytes + ? WHERE id = ?').run(buffer.length, this.cloneId);

    return localPath;
  }
}
