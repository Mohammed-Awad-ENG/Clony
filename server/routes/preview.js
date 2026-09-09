import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import db from '../db/database.js';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clonesBaseDir = path.join(__dirname, '..', '..', 'clones');

// Serve static files for a clone
router.get('/:id/*path', async (req, res) => {
  const cloneId = req.params.id;
  // Express 5 returns named wildcards as arrays — join back into a string
  const rawPath = req.params.path;
  const clonePath = Array.isArray(rawPath) ? rawPath.join('/') : rawPath;

  try {
    // Basic verification that clone exists
    const clone = db.prepare('SELECT directory, url FROM clones WHERE id = ?').get(cloneId);
    if (!clone) return res.status(404).send('Clone not found');

    // Securely construct path — resolve to get an absolute canonical path
    const targetPath = path.resolve(clone.directory, clonePath);
    
    // Prevent path traversal
    if (!targetPath.startsWith(path.resolve(clone.directory))) {
      return res.status(403).send('Forbidden');
    }

    if (fs.existsSync(targetPath)) {
      if (targetPath.endsWith('.html')) {
        let html = fs.readFileSync(targetPath, 'utf8');
        // Inject SW killer to prevent rogue service workers from serving HTML for 404 missing chunks
        const swKiller = `<script>
          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistrations().then(function(r) {
              for(let i=0; i<r.length; i++) r[i].unregister();
            });
          }
        </script>`;
        if (html.includes('<head>')) {
          html = html.replace('<head>', '<head>' + swKiller);
        } else {
          html = swKiller + html;
        }
        res.set('Content-Type', 'text/html');
        return res.send(html);
      } else {
        return res.sendFile(targetPath);
      }
    } else {
      // Offline fallback: proxy missing SPA chunks/assets directly from original site to bypass CORS
      if (clone.url) {
        try {
          const origin = new URL(clone.url).origin;
          
          // Extract the exact path + query string after the clone UUID to preserve parameters like ?dpl=
          const match = req.originalUrl.match(new RegExp(`/api/preview/${cloneId}/(.*)`));
          const relativePathWithQuery = match ? match[1] : clonePath;
          const originalUrl = new URL('/' + relativePathWithQuery, origin).href;
          
          const response = await fetch(originalUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': '*/*'
            }
          });
          
          if (response.ok) {
            const contentType = response.headers.get('content-type') || '';
            
            // Prevent serving HTML fallback pages as JS/CSS assets, which causes "Unexpected token '<'"
            if (contentType.includes('text/html') && /\.(js|css|woff2?|png|jpe?g|gif|svg|mp4|webm)(\?.*)?$/i.test(originalUrl)) {
               return res.status(404).type('text/plain').send('Asset not found on live site (returned HTML fallback)');
            }

            res.set('Access-Control-Allow-Origin', '*');
            if (contentType) res.set('Content-Type', contentType);
            
            const arrayBuffer = await response.arrayBuffer();
            return res.send(Buffer.from(arrayBuffer));
          }
        } catch(e) {
          console.error('Preview proxy fallback failed:', e.message);
        }
      }
      res.status(404).type('text/plain').send('File not found: ' + clonePath);
    }
  } catch (e) {
    console.error('Preview error:', e);
    res.status(500).send('Server error: ' + e.message);
  }
});

export default router;
