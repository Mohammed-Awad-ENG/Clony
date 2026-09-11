import fs from 'fs';
import path from 'path';
import * as cheerio from 'cheerio';
import prettier from 'prettier';

/**
 * Builds a map of asset hash filename -> human readable filename based on original URLs.
 * Handles collisions by appending a counter.
 */
export function buildAssetRenameMap(assets) {
  const map = new Map();
  const usedNames = new Set();

  for (const asset of assets) {
    const hashName = path.basename(asset.local_path); // e.g. 12345.png
    let originalName = 'asset';
    
    try {
      const urlPath = new URL(asset.original_url).pathname;
      const basename = path.basename(urlPath);
      if (basename) {
        originalName = basename;
      }
    } catch (e) {}

    // Ensure it has an extension based on original hashname
    const ext = path.extname(hashName);
    if (ext && !originalName.endsWith(ext)) {
      // Sometimes original url doesn't have extension, but hashName does (detected by mime)
      originalName += ext;
    }

    // Handle collisions
    let sanitized = sanitizeFileName(originalName);
    if (!sanitized || sanitized === ext) {
      sanitized = `asset${ext}`;
    }
    
    // Truncate to avoid ENAMETOOLONG
    const maxLen = 100;
    const nameWithoutExt = path.basename(sanitized, ext);
    let finalNameWithoutExt = nameWithoutExt.length > maxLen ? nameWithoutExt.substring(0, maxLen) : nameWithoutExt;
    let finalName = `${finalNameWithoutExt}${ext}`;

    let counter = 1;
    let nameToTry = finalName;
    while (usedNames.has(nameToTry)) {
      nameToTry = `${finalNameWithoutExt}-${counter}${ext}`;
      counter++;
    }

    usedNames.add(nameToTry);
    map.set(hashName, nameToTry);
  }

  return map;
}

export function sanitizeFileName(name) {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
}

/**
 * Determines category folder for an asset based on extension and content_type.
 */
export function getAssetCategory(asset) {
  const type = (asset.content_type || '').toLowerCase();
  const ext = path.extname(asset.local_path).toLowerCase();

  if (type.includes('image') || ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico'].includes(ext)) {
    return 'images';
  }
  if (type.includes('css') || ext === '.css') {
    return 'css';
  }
  if (type.includes('javascript') || type.includes('ecmascript') || ext === '.js') {
    return 'js';
  }
  if (type.includes('font') || ['.woff', '.woff2', '.ttf', '.otf', '.eot'].includes(ext)) {
    return 'fonts';
  }
  return 'assets';
}

/**
 * Copies _assets from sourceDir to outputDir organized by category.
 * Returns a map of old relative path (_assets/hash.png) to new relative path (images/name.png).
 */
export function copyAssetsOrganized(sourceDir, outputDir, assets, renameMap) {
  const pathMapping = new Map();

  for (const asset of assets) {
    const oldLocalPath = asset.local_path; // e.g. _assets/12345.png
    const hashName = path.basename(oldLocalPath);
    const newName = renameMap.get(hashName) || hashName;
    const category = getAssetCategory(asset);
    
    const newRelativePath = `${category}/${newName}`;
    pathMapping.set(oldLocalPath, newRelativePath);

    // Also support absolute paths that start with /_assets
    pathMapping.set('/' + oldLocalPath, '/' + newRelativePath);
    // And bare paths
    pathMapping.set(hashName, newRelativePath);

    const sourcePath = path.join(sourceDir, oldLocalPath);
    const targetPath = path.join(outputDir, newRelativePath);

    if (fs.existsSync(sourcePath)) {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.copyFileSync(sourcePath, targetPath);
    }
  }

  return pathMapping;
}

/**
 * Extracts metadata like title, language, direction, meta tags.
 */
export function extractPageMeta(html) {
  const $ = cheerio.load(html);
  const title = $('title').text() || 'Clony Export';
  const lang = $('html').attr('lang') || 'en';
  const dir = $('html').attr('dir') || 'ltr';
  
  const metaTags = [];
  $('meta').each((_, el) => {
    metaTags.push($.html(el));
  });

  return { title, lang, dir, metaTags: metaTags.join('\n') };
}

/**
 * Gets inner HTML of body.
 */
export function htmlToBodyContent(html) {
  const $ = cheerio.load(html);
  return $('body').html() || '';
}

/**
 * Converts a path like 'intl/ar/about.html' to 'IntlArAbout'
 */
export function sanitizeComponentName(pagePath) {
  if (pagePath === 'index.html' || pagePath === '/') return 'Home';
  
  const withoutExt = pagePath.replace(/\.html$/, '');
  const parts = withoutExt.split(/[\/\-_]/);
  
  let name = parts
    .filter(p => p.length > 0)
    .map(p => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');
    
  // If it ends with Index, remove it unless it's just 'Index'
  if (name.endsWith('Index') && name.length > 5) {
    name = name.slice(0, -5);
  }
  
  return name || 'Page';
}

/**
 * Converts pages array to routes mapping.
 */
export function generateRoutes(pages) {
  return pages.map(page => {
    let route = '/' + page.local_path.replace(/\\/g, '/');
    route = route.replace(/\/index\.html$/, '/');
    if (route !== '/') {
      route = route.replace(/\.html$/, '');
    }
    return {
      path: route,
      componentName: sanitizeComponentName(page.local_path),
      originalPath: page.local_path,
      page
    };
  });
}

/**
 * Format code with Prettier safely.
 */
export async function formatWithPrettier(content, parser) {
  if (!content) return content;
  
  // Prevent V8 Heap Out of Memory crashes by skipping AST parsing for massive files
  if (content.length > 500 * 1024) { // 500 KB limit
    console.warn(`Skipping Prettier for ${parser}: content too large (${Math.round(content.length / 1024)}KB)`);
    return content;
  }

  try {
    return await prettier.format(content, { 
      parser,
      printWidth: 100,
      singleQuote: true,
      htmlWhitespaceSensitivity: 'ignore'
    });
  } catch (e) {
    console.warn(`Prettier failed for ${parser}:`, e.message);
    return content; // Fallback to unformatted
  }
}

/**
 * Update HTML string replacing old asset paths with new ones.
 */
export function rewriteHtmlPaths(html, pathMapping, pageLocalPath, liveUrl) {
  const $ = cheerio.load(html);
  const pageDir = path.dirname('/' + pageLocalPath);

  function getNewRelative(oldVal, isAnchor = false) {
    // Determine the absolute path first based on the current page
    let absPath;
    try {
      if (oldVal.startsWith('/')) {
        absPath = oldVal;
      } else {
        absPath = path.posix.resolve(pageDir, oldVal);
      }
    } catch (e) {
      return oldVal;
    }

    // Now convert absPath to _assets/... format to lookup
    const canonical = absPath.replace(/^\//, ''); // e.g. _assets/123.png

    if (pathMapping.has(canonical)) {
      const newCanonical = pathMapping.get(canonical); // e.g. images/logo.png
      // Build relative path back to it
      let rel = path.posix.relative(pageDir, '/' + newCanonical);
      if (rel === '') rel = path.posix.basename(newCanonical);
      return rel;
    }
    
    // Live URL Fallback: if not found in pathMapping and it's an absolute path,
    // point it to the original live website to prevent local file:/// errors (skip for anchor tags to preserve internal routing)
    if (liveUrl && oldVal.startsWith('/') && !isAnchor) {
      try {
        return new URL(oldVal, liveUrl).href;
      } catch (e) {
        // ignore invalid urls
      }
    }
    
    return oldVal;
  }

  $('[href]').each((_, el) => {
    const isAnchor = el.tagName === 'a' || el.tagName === 'A';
    const href = $(el).attr('href');
    if (href && !href.startsWith('http') && !href.startsWith('data:')) {
      $(el).attr('href', getNewRelative(href, isAnchor));
    }
  });

  $('[src]').each((_, el) => {
    const src = $(el).attr('src');
    if (src && !src.startsWith('http') && !src.startsWith('data:')) {
      $(el).attr('src', getNewRelative(src));
    }
  });

  // Check style tags and style attributes for url()
  $('[style]').each((_, el) => {
    let style = $(el).attr('style');
    if (style && style.includes('url(')) {
      style = style.replace(/url\(['"]?([^'"()]+)['"]?\)/g, (match, url) => {
        if (url.startsWith('data:') || url.startsWith('http')) return match;
        return `url('${getNewRelative(url)}')`;
      });
      $(el).attr('style', style);
    }
  });

  $('style').each((_, el) => {
    let css = $(el).html();
    if (css && css.includes('url(')) {
      css = css.replace(/url\(['"]?([^'"()]+)['"]?\)/g, (match, url) => {
        if (url.startsWith('data:') || url.startsWith('http')) return match;
        return `url('${getNewRelative(url)}')`;
      });
      $(el).html(css);
    }
  });

  // Replace srcset
  $('[srcset]').each((_, el) => {
    let srcset = $(el).attr('srcset');
    if (srcset) {
      const parts = srcset.split(',').map(part => {
        const [url, size] = part.trim().split(/\s+/);
        if (url && !url.startsWith('data:') && !url.startsWith('http')) {
          return `${getNewRelative(url)}${size ? ' ' + size : ''}`;
        }
        return part;
      });
      $(el).attr('srcset', parts.join(', '));
    }
  });

  return $.html();
}

export const STATIC_INTERACTIVITY_SCRIPT = `
<script>
  /* Clony: Generic interactivity for static exports (popup dismissal) */
  document.addEventListener('DOMContentLoaded', () => {
    
    function cleanupModal(target) {
      target.style.display = 'none';
      
      // Stop any media playing inside the dismissed container
      const mediaElements = target.querySelectorAll('video, audio');
      mediaElements.forEach(media => {
        if (typeof media.pause === 'function') media.pause();
      });
      const iframes = target.querySelectorAll('iframe');
      iframes.forEach(iframe => {
        const src = iframe.src;
        iframe.src = src; // Reload iframe to stop playing media
      });
      
      // Restore body scrolling if it was locked by the modal
      if (document.body.style.overflow === 'hidden' || document.body.style.position === 'fixed') {
        document.body.style.overflow = '';
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.width = '';
      }
    }

    document.addEventListener('click', function(e) {
      let target = e.target;
      
      // 1. Backdrop click detection
      if (target && target !== document.body && target.tagName !== 'HTML') {
        const style = window.getComputedStyle(target);
        const cName = (typeof target.className === 'string' ? target.className : '').toLowerCase();
        if (
          (style.position === 'fixed' || style.position === 'absolute') && 
          (cName.includes('overlay') || cName.includes('backdrop') || cName.includes('modal-wrapper') || style.backgroundColor.startsWith('rgba'))
        ) {
           // If click was exactly on the backdrop (not on its modal children)
           if (e.target === target) {
              cleanupModal(target);
              return;
           }
        }
      }

      // 2. Close button click detection
      while (target && target !== document.body) {
        if (target.tagName === 'A' && target.getAttribute('href') && target.getAttribute('href').startsWith('#')) {
          return; // Let normal anchor links work
        }
        
        const isButton = target.tagName === 'BUTTON' || target.getAttribute('role') === 'button';
        const text = (target.textContent || '').trim().toLowerCase();
        const ariaLabel = (target.getAttribute('aria-label') || '').toLowerCase();
        const className = (typeof target.className === 'string' ? target.className : '').toLowerCase();
        
        const isClose = ariaLabel.includes('close') || ariaLabel.includes('dismiss') || 
                        className.includes('close') || className.includes('dismiss') ||
                        (isButton && (text === 'x' || text === 'close' || text === 'dismiss'));
                        
        if (isClose) {
          let container = target.parentElement;
          let containerToHide = null;
          
          while (container && container !== document.body && container.tagName !== 'HTML') {
            const style = window.getComputedStyle(container);
            const cName = (typeof container.className === 'string' ? container.className : '').toLowerCase();
            const role = container.getAttribute('role');
            
            if (container.tagName === 'HEADER' || container.tagName === 'NAV') {
               break; // Don't hide headers/navbars
            }
            
            if (
              style.position === 'fixed' || 
              container.tagName === 'DIALOG' || 
              role === 'dialog' || 
              role === 'alertdialog' || 
              cName.includes('modal') || 
              cName.includes('popup') || 
              cName.includes('overlay') ||
              cName.includes('toast') ||
              cName.includes('backdrop')
            ) {
              containerToHide = container; // Keep updating to find the HIGHEST wrapper
            }
            container = container.parentElement;
          }
          
          if (containerToHide) {
            cleanupModal(containerToHide);
            
            e.preventDefault();
            e.stopPropagation();
            return;
          }
        }
        target = target.parentElement;
      }
    });
  });
</script>
`;

/**
 * Rewrites internal links to SPA route paths for React/Next.js/Vue exports.
 * E.g. ../about/index.html -> /about
 */
export function rewriteLinksToRoutes(html, pageLocalPath) {
  const $ = cheerio.load(html);
  const pageDir = path.dirname('/' + pageLocalPath.replace(/\\/g, '/'));

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (
      !href ||
      href.startsWith('http') ||
      href.startsWith('//') ||
      href.startsWith('data:') ||
      href.startsWith('#') ||
      href.startsWith('mailto:') ||
      href.startsWith('tel:')
    ) {
      return;
    }

    let target = href;
    const hashParts = target.split('#');
    target = hashParts[0];
    const queryParts = target.split('?');
    target = queryParts[0];

    if (!target) return;

    // Resolve to absolute path based on page dir
    if (!target.startsWith('/')) {
      target = path.posix.resolve(pageDir, target);
    }

    let routePath = target;
    if (routePath.endsWith('/index.html')) {
      routePath = routePath.slice(0, -11);
    } else if (routePath.endsWith('.html')) {
      routePath = routePath.slice(0, -5);
    }
    
    if (routePath.endsWith('/') && routePath.length > 1) {
      routePath = routePath.slice(0, -1);
    }
    
    // Ensure it's absolute for SPA routing
    if (!routePath.startsWith('/')) {
      routePath = '/' + routePath;
    }
    if (routePath === '') routePath = '/';

    let rel = routePath;
    if (queryParts.length > 1) rel += '?' + queryParts[1];
    if (hashParts.length > 1) rel += '#' + hashParts[1];

    $(el).attr('href', rel);
  });

  return $.html();
}

/**
 * Rewrites internal links (e.g. /about) to relative .html paths (e.g. ../about/index.html)
 * for static HTML exports so they work on file:/// protocols.
 */
export function rewriteInternalLinks(html, pageLocalPath) {
  const $ = cheerio.load(html);
  const pageDir = path.dirname('/' + pageLocalPath.replace(/\\/g, '/'));

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    
    // Ignore external, anchor, and data links
    if (
      !href || 
      href.startsWith('http') || 
      href.startsWith('//') || 
      href.startsWith('data:') || 
      href.startsWith('#') || 
      href.startsWith('mailto:') ||
      href.startsWith('tel:')
    ) {
      return;
    }
    
    let target = href;
    const hashParts = target.split('#');
    target = hashParts[0];
    const queryParts = target.split('?');
    target = queryParts[0];
    
    if (!target) return; // e.g. href was just "?" or "#"
    
    // If it's a relative link, resolve it to an absolute path first
    if (!target.startsWith('/')) {
      target = path.posix.resolve(pageDir, target);
    }
    
    // If there's no extension, it points to a directory/route -> append index.html
    if (!path.extname(target)) {
      if (!target.endsWith('/')) target += '/';
      target += 'index.html';
    }
    
    let rel = path.posix.relative(pageDir, target);
    if (rel === '') rel = path.posix.basename(target);
    
    // Reattach hash/query
    if (queryParts.length > 1) rel += '?' + queryParts[1];
    if (hashParts.length > 1) rel += '#' + hashParts[1];
    
    $(el).attr('href', rel);
  });

  return $.html();
}

/**
 * Extracts and bundles only the stylesheets and inline styles referenced by a specific page.
 * Prevents cross-page stylesheet pollution and layer conflicts.
 */
export function extractPageCss(sourceDir, page, pathMapping, options = {}, assets = []) {
  const targetCssPath = options.targetCssPath || 'src/assets/styles.css';
  const rootRelative = options.rootRelative !== false;
  let pageCss = '';

  const srcPath = path.join(sourceDir, page.local_path);
  if (!fs.existsSync(srcPath)) return '';

  const html = fs.readFileSync(srcPath, 'utf8');
  const $ = cheerio.load(html);
  const pageDir = path.dirname('/' + page.local_path.replace(/\\/g, '/'));

  // 1. Extract linked stylesheets in document order
  $('link[rel="stylesheet"]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href || href.startsWith('http://') || href.startsWith('https://') || href.startsWith('data:')) return;

    const cleanHref = href.split('?')[0].split('#')[0];
    let assetRelPath;
    if (cleanHref.startsWith('/')) {
      assetRelPath = cleanHref.replace(/^\//, '');
    } else {
      const absPath = path.posix.resolve(pageDir, cleanHref);
      assetRelPath = absPath.replace(/^\//, '');
    }

    let diskPath = path.join(sourceDir, assetRelPath);
    if (!fs.existsSync(diskPath) && assets.length > 0) {
      const base = path.basename(cleanHref);
      const matchedAsset = assets.find(a => path.basename(a.local_path) === base || a.original_url === href);
      if (matchedAsset) {
        diskPath = path.join(sourceDir, matchedAsset.local_path);
        assetRelPath = matchedAsset.local_path;
      }
    }

    if (fs.existsSync(diskPath)) {
      let content = fs.readFileSync(diskPath, 'utf8');
      content = rewriteCssUrls(content, pathMapping, targetCssPath, assetRelPath, { rootRelative });
      pageCss += `\n/* Linked stylesheet: ${href} */\n${content}\n`;
    }
  });

  // 2. Extract inline <style> blocks in document order
  $('style').each((_, el) => {
    let content = $(el).html();
    if (content && content.trim()) {
      content = content.replace(/\\n/g, '\n');
      content = rewriteCssUrls(content, pathMapping, targetCssPath, page.local_path, { rootRelative });
      pageCss += `\n/* Inline style from ${page.local_path} */\n${content}\n`;
    }
  });

  return pageCss;
}

/**
 * Merges all CSS strings (both files and inline) into one string, rewriting paths.
 * Resolves paths relative to a target CSS file (e.g. css/styles.css)
 */
export function mergeCss(sourceDir, assets, htmlPages, pathMapping, options = {}) {
  let mergedCss = '';
  const targetCssPath = options.targetCssPath || 'css/styles.css';
  const rootRelative = options.rootRelative;

  // 1. Process external CSS files from assets
  const cssAssets = assets.filter(a => getAssetCategory(a) === 'css');
  for (const asset of cssAssets) {
    const srcPath = path.join(sourceDir, asset.local_path);
    if (fs.existsSync(srcPath)) {
      let cssContent = fs.readFileSync(srcPath, 'utf8');
      cssContent = rewriteCssUrls(cssContent, pathMapping, targetCssPath, asset.local_path, { rootRelative });
      mergedCss += `\n/* Source: ${asset.original_url} */\n${cssContent}\n`;
    }
  }

  // 2. Process inline <style> blocks from HTML pages
  for (const page of htmlPages) {
    const srcPath = path.join(sourceDir, page.local_path);
    if (fs.existsSync(srcPath)) {
      const html = fs.readFileSync(srcPath, 'utf8');
      const $ = cheerio.load(html);
      $('style').each((_, el) => {
        let cssContent = $(el).html();
        if (cssContent && cssContent.trim()) {
          // Cheerio may return literal \n text — normalize to actual newlines
          cssContent = cssContent.replace(/\\n/g, '\n');
          cssContent = rewriteCssUrls(cssContent, pathMapping, targetCssPath, page.local_path, { rootRelative });
          mergedCss += `\n/* Inline style from ${page.local_path} */\n${cssContent}\n`;
        }
      });
    }
  }

  return mergedCss;
}

/**
 * Helper to rewrite url() in CSS content.
 * @param {string} cssContent The raw CSS string.
 * @param {Map} pathMapping The map of old to new paths (e.g. _assets/1.png -> images/logo.png).
 * @param {string} targetCssPath Where this CSS will live in the output (e.g. css/styles.css).
 * @param {string} originalSourcePath The local path where the CSS originally lived (e.g. _assets/2.css or index.html).
 * @param {object} options Optional settings such as { rootRelative: boolean }.
 */
export function rewriteCssUrls(cssContent, pathMapping, targetCssPath, originalSourcePath, options = {}) {
  if (!cssContent) return '';
  return cssContent.replace(/url\(['"]?([^'"()]+)['"]?\)/g, (match, url) => {
    if (url.startsWith('data:') || url.startsWith('http') || url.startsWith('blob:')) return match;
    
    // Resolve original absolute path within clone directory
    const sourceDir = path.dirname('/' + originalSourcePath.replace(/\\/g, '/'));
    const absPath = path.posix.resolve(sourceDir, url);
    const canonical = absPath.replace(/^\//, ''); // e.g. _assets/123.png
    
    if (pathMapping.has(canonical)) {
      const newCanonical = pathMapping.get(canonical); // e.g. images/logo.png or fonts/font.woff2
      
      // If rootRelative is requested, or targetCssPath is in src/ or root-relative,
      // or if it is a font asset in public/fonts/:
      if (
        options.rootRelative ||
        newCanonical.startsWith('fonts/') ||
        (typeof targetCssPath === 'string' && (targetCssPath.startsWith('/') || targetCssPath.startsWith('src/')))
      ) {
        return `url('/${newCanonical.replace(/^\//, '')}')`;
      }

      const targetDir = path.dirname('/' + targetCssPath); // e.g. /css
      let rel = path.posix.relative(targetDir, '/' + newCanonical);
      return `url('${rel}')`;
    }
    
    return match; // Fallback
  });
}
