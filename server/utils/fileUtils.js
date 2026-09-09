import fs from 'fs';
import path from 'path';

export function ensureDirSync(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function sanitizeFileName(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
}

export function generateLocalPath(urlObj, rootDir) {
  let relativePath = urlObj.pathname;
  if (relativePath === '/' || relativePath === '') {
    relativePath = '/index.html';
  } else if (!path.extname(relativePath)) {
    relativePath += '/index.html';
  }
  
  // Prevent directory traversal
  const safePath = path.resolve(rootDir, '.' + relativePath);
  if (!safePath.startsWith(rootDir)) {
    return path.join(rootDir, 'index.html');
  }
  return safePath;
}
