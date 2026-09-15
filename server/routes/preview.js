import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import db from '../db/database.js';
import { analyzeAndProcessScripts } from '../services/scriptAnalyzer.js';
import { STATIC_INTERACTIVITY_SCRIPT, UNIVERSAL_STUBS_SCRIPT } from '../services/exports/exportUtils.js';

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
    let targetPath = path.resolve(clone.directory, clonePath);
    
    // Prevent path traversal
    if (!targetPath.startsWith(path.resolve(clone.directory))) {
      return res.status(403).send('Forbidden');
    }

    if (fs.existsSync(targetPath)) {
      if (fs.statSync(targetPath).isDirectory()) {
        if (fs.existsSync(path.join(targetPath, 'index.html'))) {
          targetPath = path.join(targetPath, 'index.html');
        } else {
          return res.status(403).send('Directory listing forbidden');
        }
      }
      if (targetPath.endsWith('.html')) {
        let html = fs.readFileSync(targetPath, 'utf8');
        // Run script analysis to strip SPA framework scripts that crash the preview
        html = analyzeAndProcessScripts(html);
        // Inject SW killer to prevent rogue service workers from serving HTML for 404 missing chunks
        // Also inject Clony UI overrides to ensure fixed overlays can be closed on mobile viewports
        const clonyOverrides = `<script>
          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistrations().then(function(r) {
              for(let i=0; i<r.length; i++) r[i].unregister();
            });
          }
        </script>
        <style>
          /* Clony overrides for preview */
          button[aria-label*="Dismiss"], button[aria-label*="Close"], button[aria-label*="dismiss"], button[aria-label*="close"] {
            display: flex !important;
          }
        </style>
        ${STATIC_INTERACTIVITY_SCRIPT}`;
        if (html.includes('<head>')) {
          html = html.replace('<head>', '<head>\n' + UNIVERSAL_STUBS_SCRIPT + '\n' + clonyOverrides);
        } else {
          html = UNIVERSAL_STUBS_SCRIPT + '\n' + clonyOverrides + html;
        }
        res.set('Content-Type', 'text/html; charset=utf-8');
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
