import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import * as archiver from 'archiver';
import crypto from 'crypto';
import db from '../db/database.js';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clonesBaseDir = path.join(__dirname, '..', '..', 'clones');
const exportsBaseDir = path.join(__dirname, '..', '..', 'data', 'exports');

if (!fs.existsSync(exportsBaseDir)) {
  fs.mkdirSync(exportsBaseDir, { recursive: true });
}

const GENERATORS = {
  'html':   () => import('../services/exports/cleanHtmlGenerator.js'),
  'single': () => import('../services/exports/singleHtmlGenerator.js'),
  'react':  () => import('../services/exports/reactGenerator.js'),
  'nextjs': () => import('../services/exports/nextjsGenerator.js'),
  'vue':    () => import('../services/exports/vueGenerator.js'),
};

function createZipArchive(options) {
  return new archiver.ZipArchive(options);
}

router.get('/:id/:format', async (req, res) => {
  const { id, format } = req.params;
  let tmpDir = null;
  
  try {
    const clone = db.prepare('SELECT * FROM clones WHERE id = ?').get(id);
    if (!clone || clone.status !== 'completed') {
      return res.status(404).json({ error: 'Clone not found or not completed' });
    }

    const sourceDir = clone.directory;
    const outputFilename = `clony-${clone.domain.replace(/[^a-z0-9]/gi, '_').toLowerCase()}-${format}.zip`;

    // If it's just raw ZIP, we stream it directly from the clone directory
    if (format === 'zip') {
      res.attachment(outputFilename);
      const archive = createZipArchive({ zlib: { level: 9 } });
      archive.on('error', (err) => {
        if (!res.headersSent) res.status(500).send({ error: err.message });
      });
      archive.pipe(res);
      archive.directory(sourceDir, false);
      await archive.finalize();
      return;
    }

    if (!GENERATORS[format]) {
      return res.status(400).json({ error: `Unknown export format '${format}'` });
    }

    // Set a timeout for the entire generation process
    req.setTimeout(1800000); // 30 minutes max for massive local exports

    // Fetch pages and assets
    const pages = db.prepare('SELECT * FROM pages WHERE clone_id = ?').all(id);
    const assets = db.prepare('SELECT * FROM assets WHERE clone_id = ?').all(id);

    // Create temp directory for generation
    tmpDir = path.join(exportsBaseDir, `tmp-${crypto.randomUUID()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    // Execute the generator
    const generatorModule = await GENERATORS[format]();
    await generatorModule.generate(sourceDir, tmpDir, clone, pages, assets);

    // ZIP the temp directory and stream
    res.attachment(outputFilename);
    const archive = createZipArchive({ zlib: { level: 9 } });
    
    archive.on('error', (err) => {
      console.error(`Archiver error for format ${format}:`, err);
      if (!res.headersSent) res.status(500).send({ error: err.message });
    });

    archive.pipe(res);
    archive.directory(tmpDir, false);
    
    await archive.finalize();

  } catch (error) {
    console.error(`Export failed for format ${format}:`, error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to generate export' });
    }
  } finally {
    // Cleanup temp directory
    if (tmpDir && fs.existsSync(tmpDir)) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (cleanupErr) {
        console.error(`Failed to cleanup temp dir ${tmpDir}:`, cleanupErr);
      }
    }
  }
});

export default router;
