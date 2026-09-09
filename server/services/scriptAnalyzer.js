import * as cheerio from 'cheerio';

const KEEP_PATTERNS = [
  /jquery/i, /bootstrap/i, /swiper/i, /gsap/i, /aos/i, /lottie/i, /alpine/i,
  /querySelector/, /classList/, /addEventListener/
];

const STRIP_PATTERNS = [
  // Network requests
  /fetch\(/, /XMLHttpRequest/, /axios\./, /\.post\(/, /\.get\(/,
  // Analytics & tracking
  /gtag\(/, /ga\(/, /fbq\(/, /_paq/, /hotjar/, /dataLayer/,
  // SPA routers & frameworks
  /createBrowserRouter/, /createApp/, /ReactDOM\.render/, /ReactDOM\.createRoot/,
  // Auth/session
  /localStorage\.getItem\('token'\)/, /sessionStorage/, /document\.cookie\s*=/,
  // Google internal framework patterns
  /google\.kEI/, /google\.kHL/, /google\.sn\s*=/, /google\.erd/,
  /google\.log\s*=/, /google\.ml\s*=/, /google\.logUrl/,
  /_DumpException/, /google\.lx/, /google\.qce/,
  /window\.google\s*=\s*_g/, /google\.x\s*\|\|/,
  /navigator\.sendBeacon/, /\/gen_204/,
  // Google dynamic module loader
  /google\.load/, /google\.lx\s*\|\|/,
  // Error reporters that phone home
  /window\.onerror\s*=/, /\/httpservice\/retry/,
  // Nonce-based inline Google scripts (error framework)
  /google\.ple/, /google\.aple/,
];

const TRACKING_DOMAINS = [
  'google-analytics.com', 'googletagmanager.com', 'facebook.net', 'hotjar.com',
  'segment.com', 'mixpanel.com', 'sentry.io', 'newrelic.com'
];

// External script URLs that should be stripped (patterns)
const STRIP_SRC_PATTERNS = [
  /\/xjs\//, /\/gen_204/, /\/client_204/, /\/log\?/,
  /\/httpservice\//, /gstatic\.com.*?\/xjs/
];

export function analyzeAndProcessScripts(html) {
  const $ = cheerio.load(html);

  $('script').each((i, el) => {
    const src = $(el).attr('src');
    const content = $(el).html() || '';

    // Strip external scripts from tracking domains
    if (src) {
      if (TRACKING_DOMAINS.some(domain => src.includes(domain))) {
        $(el).remove();
        return;
      }
      // Strip external scripts matching known API/framework URL patterns
      if (STRIP_SRC_PATTERNS.some(pattern => pattern.test(src))) {
        $(el).remove();
        return;
      }
    }

    // Check inline content against strip patterns
    if (STRIP_PATTERNS.some(pattern => pattern.test(content) || (src && pattern.test(src)))) {
      $(el).remove();
      return;
    }

    // If it has keep patterns, leave it untouched
    if (KEEP_PATTERNS.some(pattern => pattern.test(content) || (src && pattern.test(src)))) {
      return;
    }

    // Neutralize remaining inline scripts by wrapping in try-catch
    if (!src && content.trim()) {
      const type = $(el).attr('type');
      const isExecutable = !type || /^(text|application)\/(javascript|ecmascript)$/i.test(type) || type === 'module';
      if (isExecutable) {
        $(el).html(`try { ${content} } catch(e) { /* Clony: neutralized */ }`);
      }
    }
  });

  // Also rewrite hardcoded absolute paths in remaining inline scripts
  // e.g. '/images/foo.png' → '_assets/...' won't work generically,
  // but we can at least suppress Google's error reporting by stubbing globals
  const stubScript = `<script>
    // Global stubs for Google internal APIs to prevent common "not a function" errors
    window._ = window._ || {};
    _._DumpException = function(e){ console.warn("Clony: Suppressed Google _DumpException ->", e); };
    window.google = window.google || {};
    google.log = function(){};
    google.ml = function(){ return null; };
    google.logUrl = function(){ return ''; };
    google.lx = function(){};

    // Stub missing performance API in sandboxed iframes (fixes Next.js web vitals 'startTime' crash)
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

    // Custom Error Handler for Clony (catches known cloning errors)
    window.addEventListener('error', function(e) {
      // 1. Catch resource loading 404s (scripts, images) on the capture phase
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
          src.includes('cdn-cgi/rum') ||
          src.includes('.woff')
        )) {
          e.preventDefault();
          return;
        }
      }
      
      // 2. Catch JS runtime errors
      if (e.message && (
        e.message.includes('_DumpException') || 
        e.message.includes('google is not defined') ||
        e.message.includes('google.lx')
      )) {
        console.warn("Clony: Caught expected cloning error ->", e.message);
        e.preventDefault();
      }
    }, true); // true = use capture phase (needed for resource errors)

    window.addEventListener('unhandledrejection', function(e) {
      if (e.reason && e.reason.message && (
        e.reason.message.includes('_DumpException') ||
        e.reason.message.includes('google is not defined')
      )) {
        console.warn("Clony: Caught expected promise rejection ->", e.reason.message);
        e.preventDefault();
      }
    });
    
    // Intercept fetch requests for telemetry
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
      const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : '');
      if (url.includes('/gen_204') || url.includes('/client_204') || url.includes('/httpservice/retry')) {
        console.warn("Clony: Intercepted and mocked fetch to ->", url);
        return new Response('', { status: 200, statusText: 'OK' });
      }
      return originalFetch.apply(this, args);
    };
  </script>`;
  
  $('head').prepend(stubScript);

  return $.html();
}
