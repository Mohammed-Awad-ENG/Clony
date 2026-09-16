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

  if (type.includes('image') || ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.avif'].includes(ext)) {
    return 'images';
  }
  if (type.includes('css') || ext === '.css') {
    return 'css';
  }
  if (type.includes('javascript') || type.includes('ecmascript') || ext === '.js' || ext === '.mjs') {
    return 'js';
  }
  if (type.includes('font') || ['.woff', '.woff2', '.ttf', '.otf', '.eot'].includes(ext)) {
    return 'fonts';
  }
  // 3D models
  if (type.includes('model') || ['.glb', '.gltf', '.obj', '.fbx', '.dae', '.stl', '.ply', '.usdz'].includes(ext)) {
    return 'models';
  }
  // Binary data (WASM, Draco decoders, bin buffers)
  if (type.includes('wasm') || type.includes('octet-stream') || ['.wasm', '.bin', '.draco', '.basis', '.ktx', '.ktx2', '.dds'].includes(ext)) {
    return 'data';
  }
  // HDR / environment maps
  if (['.hdr', '.exr'].includes(ext)) {
    return 'textures';
  }
  // Audio
  if (type.includes('audio') || ['.mp3', '.ogg', '.wav', '.aac'].includes(ext)) {
    return 'audio';
  }
  // Shaders
  if (['.glsl', '.vert', '.frag', '.hlsl', '.wgsl'].includes(ext)) {
    return 'shaders';
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
    const oldLocalPath = asset.local_path; // e.g. _assets/12345.png or _assets/_data/models/car/scene.gltf
    const hashName = path.basename(oldLocalPath);
    const newName = renameMap.get(hashName) || hashName;
    const category = getAssetCategory(asset);
    
    // For path-preserved data assets, maintain the full subdirectory structure
    // so inter-file references (e.g., .gltf -> ./textures/base.png) remain valid
    const DATA_CATEGORIES = new Set(['models', 'data', 'textures', 'audio', 'shaders']);
    let newRelativePath;

    if (DATA_CATEGORIES.has(category) && oldLocalPath.includes('_data/')) {
      // Extract everything after _data/ (e.g. "models/car/scene.gltf")
      const dataSubPath = oldLocalPath.split('_data/')[1];
      newRelativePath = dataSubPath;
    } else {
      newRelativePath = `${category}/${newName}`;
    }

    pathMapping.set(oldLocalPath, newRelativePath);

    // Also support absolute paths that start with /_assets
    pathMapping.set('/' + oldLocalPath, '/' + newRelativePath);
    // And bare paths
    pathMapping.set(hashName, newRelativePath);

    // For data assets, also register the original URL pathname as a mapping key
    // so JS fetch() calls using the original path can resolve to the new local path
    if (asset.original_url) {
      try {
        const urlPath = new URL(asset.original_url).pathname;
        pathMapping.set(urlPath.replace(/^\//, ''), newRelativePath);
        pathMapping.set(urlPath, '/' + newRelativePath);
      } catch (e) {}
    }

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
 * Generates a floating UI component to navigate between exported routes.
 */
export function generateRouteNavigatorScript(routes, type = 'spa') {
  if (!routes || routes.length === 0) return '';
  
  const linksHtml = routes.map(r => {
    let href = r.path;
    if (type === 'html') {
      href = '/' + r.originalPath.replace(/\\/g, '/');
    }
    return `
      <a href="${href}" class="clony-nav-link" style="display: flex; align-items: center; gap: 8px; padding: 10px 14px; color: #e2e8f0; text-decoration: none; border-radius: 6px; transition: background 0.2s; font-size: 14px;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
        ${r.componentName || r.path}
      </a>
    `;
  }).join('');

  return `
<!-- CLONY ROUTE NAVIGATOR START (EASILY REMOVABLE) -->
<div id="clony-route-navigator" style="position: fixed; bottom: 20px; right: 20px; z-index: 999999; font-family: system-ui, -apple-system, sans-serif;">
  <div id="clony-nav-menu" style="display: none; position: absolute; bottom: 60px; right: 0; width: 280px; max-height: 400px; overflow-y: auto; background: rgba(15, 23, 42, 0.85); backdrop-filter: blur(12px); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 12px; padding: 8px; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);">
    <div style="padding: 8px 12px; margin-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.1); color: #94a3b8; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; display: flex; justify-content: space-between; align-items: center;">
      <span>Exported Pages</span>
      <span style="background: rgba(6, 214, 160, 0.2); color: #06d6a0; padding: 2px 6px; border-radius: 10px; font-size: 10px;">${routes.length}</span>
    </div>
    <style>
      .clony-nav-link:hover { background: rgba(255, 255, 255, 0.1); }
      #clony-nav-menu::-webkit-scrollbar { width: 6px; }
      #clony-nav-menu::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 3px; }
    </style>
    ${linksHtml}
  </div>
  <button id="clony-nav-toggle" style="width: 48px; height: 48px; border-radius: 50%; background: #06d6a0; color: #000; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 14px rgba(6, 214, 160, 0.4); transition: transform 0.2s;">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
  </button>
</div>
<script>
  (function() {
    var toggle = document.getElementById('clony-nav-toggle');
    var menu = document.getElementById('clony-nav-menu');
    var isOpen = false;
    toggle.addEventListener('click', function() {
      isOpen = !isOpen;
      menu.style.display = isOpen ? 'block' : 'none';
      toggle.style.transform = isOpen ? 'rotate(90deg)' : 'none';
    });
    document.addEventListener('click', function(e) {
      if (isOpen && !document.getElementById('clony-route-navigator').contains(e.target)) {
        isOpen = false;
        menu.style.display = 'none';
        toggle.style.transform = 'none';
      }
    });
  })();
</script>
<!-- CLONY ROUTE NAVIGATOR END -->
  `;
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
      
      // --- A. TAB INTERACTIVITY ---
      let tabTarget = target.closest('[role="tab"], [data-part="trigger"][data-scope="tabs"]');
      if (tabTarget) {
        let tabList = tabTarget.closest('[role="tablist"], [data-part="list"], [data-scope="tabs"]');
        if (tabList) {
          // 1. Deactivate all tabs in this list
          let allTabs = tabList.querySelectorAll('[role="tab"], [data-part="trigger"][data-scope="tabs"]');
          allTabs.forEach(t => {
            t.setAttribute('aria-selected', 'false');
            t.setAttribute('data-state', 'inactive');
            t.removeAttribute('data-selected');
          });
          
          // 2. Activate clicked tab
          tabTarget.setAttribute('aria-selected', 'true');
          tabTarget.setAttribute('data-state', 'active');
          tabTarget.setAttribute('data-selected', '');
          
          // 3. Find the corresponding panel
          let controls = tabTarget.getAttribute('aria-controls');
          let dataValue = tabTarget.getAttribute('data-value');
          let tabRoot = tabTarget.closest('[data-scope="tabs"][data-part="root"]') || document;
          
          let targetPanel = null;
          let allPanels = [];
          
          if (controls) {
            targetPanel = document.getElementById(controls);
            if (targetPanel) {
              allPanels = Array.from(targetPanel.parentElement.children).filter(el => el.getAttribute('role') === 'tabpanel' || el.hasAttribute('data-scope'));
            }
          } else if (dataValue && tabRoot !== document) {
            allPanels = Array.from(tabRoot.querySelectorAll('[role="tabpanel"], [data-part="content"]'));
            targetPanel = allPanels.find(p => p.getAttribute('data-value') === dataValue);
          }
          
          if (!targetPanel && tabRoot !== document) {
            // Fallback for generic tabs
            allPanels = Array.from(tabRoot.querySelectorAll('[role="tabpanel"]'));
            let tabIndex = Array.from(allTabs).indexOf(tabTarget);
            if (tabIndex >= 0 && tabIndex < allPanels.length) {
              targetPanel = allPanels[tabIndex];
            }
          }

          // 4. Update panels
          allPanels.forEach(p => {
            p.setAttribute('data-state', 'inactive');
            p.setAttribute('hidden', 'true');
            p.style.display = 'none';
          });
          
          if (targetPanel) {
            targetPanel.setAttribute('data-state', 'active');
            targetPanel.removeAttribute('hidden');
            targetPanel.style.display = '';
          }
          
          e.preventDefault();
          return; // Stop processing further generic interactions
        }
      }

      // --- B. ACCORDION / DISCLOSURE INTERACTIVITY ---
      let accordionBtn = target.closest('[aria-expanded]');
      if (accordionBtn) {
        // Toggle the expanded state
        let isExpanded = accordionBtn.getAttribute('aria-expanded') === 'true';
        let newState = !isExpanded;
        accordionBtn.setAttribute('aria-expanded', String(newState));
        
        let stateStr = newState ? 'open' : 'closed';
        if (accordionBtn.hasAttribute('data-state')) {
           accordionBtn.setAttribute('data-state', stateStr);
        }
        
        let controlsId = accordionBtn.getAttribute('aria-controls');
        if (controlsId) {
          let controlledRegion = document.getElementById(controlsId);
          if (controlledRegion) {
            if (controlledRegion.hasAttribute('data-state')) {
              controlledRegion.setAttribute('data-state', stateStr);
            }
            if (newState) {
              controlledRegion.removeAttribute('hidden');
              controlledRegion.style.display = '';
            } else {
              controlledRegion.setAttribute('hidden', 'true');
              controlledRegion.style.display = 'none';
            }
          }
        } else {
           // Radix UI / Ark UI often put the content as a sibling or in a known wrapper
           let nextEl = accordionBtn.nextElementSibling;
           if (nextEl && (nextEl.getAttribute('role') === 'region' || nextEl.hasAttribute('data-state'))) {
              nextEl.setAttribute('data-state', stateStr);
              if (newState) {
                nextEl.removeAttribute('hidden');
                nextEl.style.display = '';
              } else {
                nextEl.setAttribute('hidden', 'true');
                nextEl.style.display = 'none';
              }
           }
        }
        
        e.preventDefault();
        return;
      }

      // --- C. DROPDOWN / MENU (CLICK OUTSIDE) ---
      let dropdownTrigger = target.closest('[aria-haspopup="true"], [data-part="trigger"][data-scope="menu"]');
      if (dropdownTrigger) {
         let isExpanded = dropdownTrigger.getAttribute('aria-expanded') === 'true';
         let newState = !isExpanded;
         dropdownTrigger.setAttribute('aria-expanded', String(newState));
         let stateStr = newState ? 'open' : 'closed';
         if (dropdownTrigger.hasAttribute('data-state')) {
            dropdownTrigger.setAttribute('data-state', stateStr);
         }
         let controlsId = dropdownTrigger.getAttribute('aria-controls');
         let menu = controlsId ? document.getElementById(controlsId) : dropdownTrigger.nextElementSibling;
         
         if (menu && (menu.getAttribute('role') === 'menu' || menu.hasAttribute('data-state'))) {
            menu.setAttribute('data-state', stateStr);
            if (newState) {
              menu.removeAttribute('hidden');
              menu.style.display = '';
            } else {
              menu.setAttribute('hidden', 'true');
              menu.style.display = 'none';
            }
         }
      } else {
         // Click outside handler for dropdowns - close all open menus
         let openMenus = document.querySelectorAll('[role="menu"][data-state="open"], [data-scope="menu"][data-part="content"][data-state="open"]');
         openMenus.forEach(menu => {
            if (!menu.contains(e.target)) {
               menu.setAttribute('data-state', 'closed');
               menu.setAttribute('hidden', 'true');
               menu.style.display = 'none';
               let trigger = document.querySelector('[aria-controls="' + menu.id + '"]');
               if (trigger) {
                  trigger.setAttribute('aria-expanded', 'false');
                  trigger.setAttribute('data-state', 'closed');
               }
            }
         });
      }

      // --- D. MODAL / BACKDROP DISMISSAL (Existing logic) ---
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

export const UNIVERSAL_STUBS_SCRIPT = `
<script>
  /* Clony: Universal Polyfills and Neutralization Stubs */
  (function() {
    // 1. Global stubs for Google internal APIs to prevent common "not a function" errors
    window._ = window._ || {};
    _._DumpException = function(e){ console.warn("Clony: Suppressed Google _DumpException ->", e); };
    window.google = window.google || {};
    window.google.log = function(){};
    window.google.ml = function(){ return null; };
    window.google.logUrl = function(){ return ''; };
    window.google.lx = function(){};

    // 2. Stub missing performance API in sandboxed iframes (fixes Next.js web vitals 'startTime' crash)
    if (window.performance && typeof window.performance.getEntriesByType === 'function') {
      const origGetEntries = window.performance.getEntriesByType.bind(window.performance);
      window.performance.getEntriesByType = function(type) {
        const entries = origGetEntries(type);
        if (type === 'navigation' && entries.length === 0) {
          return [{ startTime: 0, responseStart: 0, responseEnd: 0, domInteractive: 0, domContentLoadedEventEnd: 0, loadEventEnd: 0, type: 'navigate' }];
        }
        return entries;
      };
    }

    // 3. Custom Error Handler for Clony (catches known cloning errors)
    window.addEventListener('error', function(e) {
      const target = e.target || e.srcElement;
      if (target && (target.tagName === 'SCRIPT' || target.tagName === 'IMG' || target.tagName === 'LINK')) {
        const src = target.src || target.href;
        if (src && (
          src.includes('google-analytics.com') ||
          src.includes('googletagmanager.com') ||
          src.includes('fonts.googleapis.com') ||
          src.includes('_next/') ||
          src.includes('_assets/') ||
          src.includes('cdn-cgi/') ||
          src.includes('.woff')
        )) {
          e.preventDefault();
          return;
        }
      }
      if (e.message && (
        e.message.includes('_DumpException') || 
        e.message.includes('google is not defined') ||
        e.message.includes('google.lx') ||
        e.message.includes('Mismatching childNodes') ||
        e.message.includes('ChunkLoadError') ||
        e.message.includes('Loading chunk') ||
        e.message.includes('Failed to fetch dynamically imported module') ||
        e.message.includes('WebGL') ||
        e.message.includes('DRACO') ||
        e.message.includes('GLTFLoader') ||
        e.message.includes('Could not load') ||
        e.message.includes('THREE')
      )) {
        console.warn("Clony: Suppressed error ->", e.message);
        e.preventDefault();
      }
    }, true);

    window.addEventListener('unhandledrejection', function(e) {
      if (e.reason && e.reason.message && (
        e.reason.message.includes('_DumpException') ||
        e.reason.message.includes('google is not defined') ||
        e.reason.message.includes('fetch')
      )) {
        e.preventDefault();
      }
    });

    // 4. Intercept fetch requests for telemetry
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
      const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : '');
      if (url.includes('/gen_204') || url.includes('/client_204') || url.includes('/httpservice/retry') || url.includes('google-analytics.com')) {
        return new Response('', { status: 200, statusText: 'OK' });
      }
      return originalFetch.apply(this, args);
    };
  })();
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
 * Generates a runtime fetch/XHR/Image interceptor script that rewrites
 * asset URLs from their original paths to the new exported paths.
 * Covers fetch(), XMLHttpRequest, and new Image().src for maximum compatibility
 * with Three.js loaders (GLTFLoader uses fetch, TextureLoader uses Image, legacy loaders use XHR).
 */
export function generateFetchRewriteScript(pathMapping) {
  // Build a mapping of original URL paths → new local paths (only for data/model assets)
  const DATA_EXTENSIONS = new Set([
    '.glb', '.gltf', '.obj', '.fbx', '.dae', '.stl', '.ply', '.usdz',
    '.bin', '.wasm', '.hdr', '.exr', '.ktx', '.ktx2', '.basis', '.dds',
    '.draco', '.json', '.mp3', '.ogg', '.wav', '.aac',
    '.glsl', '.vert', '.frag',
  ]);

  const fetchMap = {};
  for (const [oldPath, newPath] of pathMapping.entries()) {
    const ext = path.extname(oldPath).toLowerCase();
    if (DATA_EXTENSIONS.has(ext)) {
      fetchMap[oldPath] = typeof newPath === 'string' ? newPath : String(newPath);
    }
  }

  if (Object.keys(fetchMap).length === 0) return '';

  return `<script>
  /* Clony: Runtime asset path rewriter for 3D models and data assets */
  (function() {
    var __clonyAssetMap = ${JSON.stringify(fetchMap)};

    function __clonyResolve(url) {
      if (__clonyAssetMap[url]) return __clonyAssetMap[url];
      try {
        var pathname = new URL(url, location.origin).pathname;
        if (__clonyAssetMap[pathname]) return __clonyAssetMap[pathname];
        // Try without leading slash
        var bare = pathname.replace(/^\\//, '');
        if (__clonyAssetMap[bare]) return __clonyAssetMap[bare];
      } catch(e) {}
      return null;
    }

    // 1. Intercept fetch()
    var __origFetch = window.fetch;
    window.fetch = function(input, init) {
      var url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
      var resolved = __clonyResolve(url);
      if (resolved) return __origFetch.call(this, resolved, init);
      return __origFetch.call(this, input, init);
    };

    // 2. Intercept XMLHttpRequest.open()
    var __origXHROpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
      var resolved = __clonyResolve(url);
      if (resolved) arguments[1] = resolved;
      return __origXHROpen.apply(this, arguments);
    };

    // 3. Intercept new Image().src assignment
    var __origImageDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    if (__origImageDescriptor && __origImageDescriptor.set) {
      Object.defineProperty(HTMLImageElement.prototype, 'src', {
        set: function(value) {
          var resolved = __clonyResolve(value);
          __origImageDescriptor.set.call(this, resolved || value);
        },
        get: __origImageDescriptor.get
      });
    }
  })();
  </script>`;
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
