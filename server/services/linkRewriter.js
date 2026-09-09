import * as cheerio from 'cheerio';
import parseSrcset from 'parse-srcset';
import path from 'path';

export function rewriteHtmlLinks(html, pageUrl, urlMap) {
  const $ = cheerio.load(html);
  const pageUrlObj = new URL(pageUrl);

  function getRelativePath(absoluteUrl) {
    if (urlMap.has(absoluteUrl)) {
      const localPath = urlMap.get(absoluteUrl);
      // Construct relative path from current page's local path to target local path
      const currentPageLocalPath = urlMap.get(pageUrl) || 'index.html';
      const currentDir = path.dirname('/' + currentPageLocalPath);
      let relative = path.relative(currentDir, '/' + localPath);
      if (relative === '') relative = path.basename(localPath);
      return relative;
    }
    return null;
  }

  // Rewrite <a> tags
  $('a[href]').each((i, el) => {
    let href = $(el).attr('href');
    if (!href || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('#')) return;
    try {
      const absoluteUrl = new URL(href, pageUrl).href;
      const relative = getRelativePath(absoluteUrl);
      if (relative) $(el).attr('href', relative);
    } catch (e) {}
  });

  // Rewrite <img>, <script>, <source>, <video>, <audio>, <iframe> src
  $('img[src], script[src], source[src], video[src], audio[src], iframe[src]').each((i, el) => {
    let src = $(el).attr('src');
    if (!src || src.startsWith('data:')) return;
    try {
      const absoluteUrl = new URL(src, pageUrl).href;
      const relative = getRelativePath(absoluteUrl);
      if (relative) $(el).attr('src', relative);
    } catch (e) {}
  });

  // Rewrite <link href>
  $('link[href]').each((i, el) => {
    let href = $(el).attr('href');
    if (!href || href.startsWith('data:')) return;
    try {
      const absoluteUrl = new URL(href, pageUrl).href;
      const relative = getRelativePath(absoluteUrl);
      if (relative) $(el).attr('href', relative);
    } catch (e) {}
  });

  // Rewrite srcset
  $('img[srcset], source[srcset]').each((i, el) => {
    let srcset = $(el).attr('srcset');
    if (!srcset) return;
    try {
      const parsed = parseSrcset(srcset);
      const rewritten = parsed.map(p => {
        try {
          const abs = new URL(p.url, pageUrl).href;
          const rel = getRelativePath(abs);
          if (rel) {
            return rel + (p.d ? ` ${p.d}x` : '') + (p.w ? ` ${p.w}w` : '') + (p.h ? ` ${p.h}h` : '');
          }
        } catch (e) {}
        return p.url + (p.d ? ` ${p.d}x` : '') + (p.w ? ` ${p.w}w` : '') + (p.h ? ` ${p.h}h` : '');
      });
      $(el).attr('srcset', rewritten.join(', '));
    } catch (e) {}
  });

  // Rewrite inline style url() references
  $('[style]').each((i, el) => {
    let style = $(el).attr('style');
    if (!style || !style.includes('url(')) return;
    style = style.replace(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g, (match, rawUrl) => {
      if (rawUrl.startsWith('data:')) return match;
      try {
        const absoluteUrl = new URL(rawUrl, pageUrl).href;
        const relative = getRelativePath(absoluteUrl);
        if (relative) return `url('${relative}')`;
      } catch (e) {}
      return match;
    });
    $(el).attr('style', style);
  });

  // Rewrite hardcoded absolute paths in inline <script> content
  // Catches patterns like: '/images/foo.png' or "/path/to/file"
  $('script:not([src])').each((i, el) => {
    let content = $(el).html();
    if (!content) return;
    
    content = content.replace(/(['"])(\/(images|icons|assets|static|media|fonts|css|js)\/[^'"]+)\1/g, (match, quote, absPath) => {
      try {
        const absoluteUrl = new URL(absPath, pageUrl).href;
        const relative = getRelativePath(absoluteUrl);
        if (relative) return `${quote}${relative}${quote}`;
      } catch (e) {}
      return match;
    });
    
    $(el).html(content);
  });

  return $.html();
}
