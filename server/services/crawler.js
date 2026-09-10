import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import * as cheerio from 'cheerio';
import { parseRobotsTxt, isAllowed } from './robotsTxt.js';
import { AssetStore } from './assetStore.js';
import { rewriteHtmlLinks } from './linkRewriter.js';
import { rewriteCssUrls } from './cssRewriter.js';
import { analyzeAndProcessScripts } from './scriptAnalyzer.js';
import { normalize, isSameDomain } from '../utils/urlUtils.js';
import { generateLocalPath } from '../utils/fileUtils.js';
import db from '../db/database.js';

export class Crawler {
  constructor(cloneRecord, io) {
    this.cloneId = cloneRecord.id;
    this.baseUrl = cloneRecord.url;
    this.baseDomain = cloneRecord.domain;
    this.cloneDir = cloneRecord.directory;
    this.io = io;
    
    this.options = JSON.parse(cloneRecord.options || '{}');
    this.maxDepth = this.options.depth || 9999;
    this.maxPages = this.options.maxPages || 500;
    this.rateLimitMs = this.options.rateLimitMs || 1000;
    this.respectRobots = this.options.respectRobots !== false;
    
    this.assetStore = new AssetStore(this.cloneId, this.cloneDir);
    this.visitedUrls = new Set();
    this.enqueuedUrls = new Set([this.baseUrl]);
    this.queue = [{ url: this.baseUrl, depth: 0, parentUrl: null }];
    this.pagesDownloaded = 0;
    
    // Map of original absolute URL to local relative path
    this.urlMap = new Map();
    this.stopRequested = false;
  }

  async start() {
    this.robots = this.respectRobots ? await parseRobotsTxt(this.baseUrl) : null;
    
    this.browser = await chromium.launch({ headless: true });
    this.context = await this.browser.newContext({
      userAgent: 'ClonyWebCrawler/1.0',
      ignoreHTTPSErrors: true
    });
    
    try {
      await this.processQueue();
      await this.secondPassLinkRewrite();
    } finally {
      await this.context.close();
      await this.browser.close();
    }
  }

  async secondPassLinkRewrite() {
    if (this.urlMap.size === 0) return;
    console.log(`Starting second-pass link rewrite for ${this.urlMap.size} pages...`);
    
    for (const [originalUrl, relativePath] of this.urlMap.entries()) {
      try {
        const localHtmlPath = path.join(this.cloneDir, relativePath);
        if (fs.existsSync(localHtmlPath) && localHtmlPath.endsWith('.html')) {
          let html = fs.readFileSync(localHtmlPath, 'utf8');
          // rewriteHtmlLinks handles full map resolution
          const updatedHtml = rewriteHtmlLinks(html, originalUrl, this.urlMap);
          if (html !== updatedHtml) {
            fs.writeFileSync(localHtmlPath, updatedHtml);
          }
        }
      } catch (e) {
        console.error(`Second-pass rewrite failed for ${relativePath}:`, e.message);
      }
    }
    console.log('Second-pass link rewrite complete.');
  }

  async processQueue() {
    while (this.queue.length > 0 && this.pagesDownloaded < this.maxPages) {
      if (this.stopRequested) {
        console.log(`Crawl stopped manually after ${this.pagesDownloaded} pages.`);
        break;
      }
      
      const { url: currentUrl, depth, parentUrl } = this.queue.shift();
      const normalizedUrl = normalize(currentUrl) || currentUrl;
      
      if (this.visitedUrls.has(normalizedUrl)) continue;
      this.visitedUrls.add(normalizedUrl);
      
      if (this.respectRobots && !isAllowed(this.robots, currentUrl)) {
        console.log(`Skipping (robots.txt): ${currentUrl}`);
        continue;
      }

      await this.crawlPage(currentUrl, depth, parentUrl);
      
      if (this.queue.length > 0) {
        await new Promise(r => setTimeout(r, this.rateLimitMs));
      }
    }
  }

  stop() {
    this.stopRequested = true;
  }

  emitProgress(url, status, error = null) {
    const percentage = Math.min(100, Math.round((this.pagesDownloaded / this.maxPages) * 100));
    db.prepare('INSERT INTO clone_logs (clone_id, url, status, percentage) VALUES (?, ?, ?, ?)').run(this.cloneId, url, status, percentage);
    
    const payload = { cloneId: this.cloneId, url, status, percentage };
    if (error) payload.error = error;
    
    this.io.emit('crawl-progress', payload);
  }

  async crawlPage(url, depth, parentUrl) {
    console.log(`Crawling: ${url} (Depth: ${depth})`);
    
    db.prepare('UPDATE clones SET pages_found = ? WHERE id = ?').run(this.visitedUrls.size, this.cloneId);
    this.emitProgress(url, 'crawling');
    
    const page = await this.context.newPage();
    
    try {
      // Intercept responses for asset extraction
      page.on('response', async (response) => {
        const req = response.request();
        const resourceType = req.resourceType();
        const responseUrl = response.url();
        
        if (['image', 'stylesheet', 'font', 'media', 'script'].includes(resourceType)) {
          if (responseUrl.startsWith('data:')) return;
          try {
            const buffer = await response.body();
            const headers = response.headers();
            const localAssetPath = await this.assetStore.processAsset(responseUrl, buffer, headers);
            if (localAssetPath) {
              this.urlMap.set(responseUrl, localAssetPath);
              if (resourceType === 'stylesheet') {
                // Post-process CSS
                const cssContent = buffer.toString('utf-8');
                const rewrittenCss = await rewriteCssUrls(cssContent, responseUrl, (absUrl) => {
                  const mapped = this.urlMap.get(absUrl);
                  if (mapped) {
                    return path.relative(path.dirname(localAssetPath), mapped).replace(/\\/g, '/');
                  }
                  return absUrl;
                });
                const absolutePath = path.join(this.cloneDir, localAssetPath);
                fs.writeFileSync(absolutePath, rewrittenCss);
              }
            }
          } catch (e) {
            // Can happen with redirects, CORS, etc.
          }
        }
      });

      const response = await page.goto(url, { waitUntil: 'load', timeout: 60000 });
      if (!response || !response.ok()) {
        throw new Error(`Failed to load page: ${response ? response.status() : 'Unknown error'}`);
      }
      
      const contentType = response.headers()['content-type'] || '';
      if (!contentType.includes('text/html')) {
        throw new Error(`Not HTML: ${contentType}`);
      }

      // Auto-scroll to trigger lazy loading
      await page.evaluate(async () => {
        await new Promise((resolve) => {
          let totalHeight = 0;
          let scrolls = 0;
          const distance = 400;
          const timer = setInterval(() => {
            window.scrollBy(0, distance);
            totalHeight += distance;
            scrolls++;
            if (totalHeight >= document.body.scrollHeight || scrolls >= 50) {
              clearInterval(timer);
              resolve();
            }
          }, 100);
        });
      });
      
      // Wait a bit more for lazy-loaded assets to trigger network requests
      await page.waitForTimeout(1000);

      // Extract dynamic CSS from CSSOM
      const dynamicCss = await page.evaluate(() => {
        return Array.from(document.styleSheets).map(sheet => {
          try {
            if (sheet.href) return ''; // Ignore external stylesheets as they are captured via network
            return Array.from(sheet.cssRules).map(r => r.cssText).join('\\n');
          } catch (e) {
            return '';
          }
        }).join('\\n');
      });
      
      let html = await page.content();
      
      // Inject dynamic CSS
      if (dynamicCss.trim()) {
        const $ = cheerio.load(html);
        $('head').append(`<style id="clony-dynamic-css">${dynamicCss}</style>`);
        html = $.html();
      }

      // Process scripts
      html = analyzeAndProcessScripts(html);
      
      // Generate local path
      const urlObj = new URL(url);
      const localHtmlPath = generateLocalPath(urlObj, this.cloneDir);
      const relativeHtmlPath = path.relative(this.cloneDir, localHtmlPath);
      this.urlMap.set(url, relativeHtmlPath);
      
      // Rewrite links
      html = rewriteHtmlLinks(html, url, this.urlMap);
      
      // Write to disk
      const dir = path.dirname(localHtmlPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(localHtmlPath, html);

      const title = await page.title();
      
      // Record page in DB
      db.prepare(`
        INSERT INTO pages (id, clone_id, url, local_path, title, status_code, content_type, size_bytes, depth, parent_url)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(crypto.randomUUID(), this.cloneId, url, relativeHtmlPath, title, response.status(), contentType, Buffer.byteLength(html, 'utf8'), depth, parentUrl);

      this.pagesDownloaded++;
      db.prepare('UPDATE clones SET pages_downloaded = ?, total_size_bytes = total_size_bytes + ? WHERE id = ?')
        .run(this.pagesDownloaded, Buffer.byteLength(html, 'utf8'), this.cloneId);
        
      this.emitProgress(url, 'success');
      this.io.emit('sitemap-node', { cloneId: this.cloneId, url, parentUrl, title, path: relativeHtmlPath });

      // Queue new internal links
      if (depth < this.maxDepth) {
        const $ = cheerio.load(html);
        $('a[href]').each((i, el) => {
          let href = $(el).attr('href');
          if (!href || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('#')) return;
          try {
            const absoluteUrl = new URL(href, url).href;
            if (isSameDomain(this.baseUrl, absoluteUrl)) {
              const normalizedLink = normalize(absoluteUrl) || absoluteUrl;
              if (!this.enqueuedUrls.has(normalizedLink)) {
                this.enqueuedUrls.add(normalizedLink);
                this.queue.push({ url: absoluteUrl, depth: depth + 1, parentUrl: url });
              }
            }
          } catch (e) {}
        });
      }

    } catch (error) {
      console.error(`Error crawling ${url}:`, error.message);
      this.emitProgress(url, 'failed', error.message);
    } finally {
      await page.close();
    }
  }
}
