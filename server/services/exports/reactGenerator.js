import fs from 'fs';
import path from 'path';
import * as cheerio from 'cheerio';
import { 
  buildAssetRenameMap, 
  copyAssetsOrganized, 
  rewriteHtmlPaths, 
  mergeCss, 
  extractPageCss,
  formatWithPrettier,
  rewriteLinksToRoutes,
  STATIC_INTERACTIVITY_SCRIPT,
  UNIVERSAL_STUBS_SCRIPT,
  generateRouteNavigatorScript,
  generateFetchRewriteScript
} from './exportUtils.js';
import { htmlToJsx } from './htmlToJsx.js';

export async function generate(sourceDir, outputDir, cloneRecord, pages, assets) {
  const publicDir = path.join(outputDir, 'public');
  const srcDir = path.join(outputDir, 'src');
  const pagesDir = path.join(srcDir, 'pages');
  const assetsDir = path.join(srcDir, 'assets');
  const pagesCssDir = path.join(assetsDir, 'pages');

  [publicDir, srcDir, pagesDir, assetsDir, pagesCssDir].forEach(d => fs.mkdirSync(d, { recursive: true }));

  // 1. Build rename map and copy assets to public/
  const renameMap = buildAssetRenameMap(assets);
  const pathMapping = copyAssetsOrganized(sourceDir, publicDir, assets, renameMap);
  
  const reactPathMapping = new Map();
  for (const [key, value] of pathMapping) {
    reactPathMapping.set(key, '/' + value.replace(/\\/g, '/'));
  }

  // 2. Identify entry page and extract root attributes for index.html
  const entryPage = pages.find(p => p.local_path === 'index.html' || p.local_path === '/') || pages[0];
  let entryHtmlClass = '';
  let entryHtmlStyle = '';
  let entryBodyClass = '';
  if (entryPage) {
    const entrySrcPath = path.join(sourceDir, entryPage.local_path);
    if (fs.existsSync(entrySrcPath)) {
      const entryHtml = fs.readFileSync(entrySrcPath, 'utf8');
      const $entry = cheerio.load(entryHtml);
      entryHtmlClass = $entry('html').attr('class') || '';
      entryHtmlStyle = $entry('html').attr('style') || '';
      entryBodyClass = $entry('body').attr('class') || '';
    }
  }

  // Generate entry styles into src/assets/styles.css
  if (entryPage) {
    const entryCss = extractPageCss(sourceDir, entryPage, pathMapping, { 
      targetCssPath: 'src/assets/styles.css', 
      rootRelative: true 
    }, assets);
    const formattedEntryCss = await formatWithPrettier(entryCss, 'css');
    fs.writeFileSync(path.join(assetsDir, 'styles.css'), formattedEntryCss);
  } else {
    const mergedCss = mergeCss(sourceDir, assets, pages, pathMapping, { 
      targetCssPath: 'src/assets/styles.css', 
      rootRelative: true 
    });
    const formattedCss = await formatWithPrettier(mergedCss, 'css');
    fs.writeFileSync(path.join(assetsDir, 'styles.css'), formattedCss);
  }

  // 3. Process each HTML page to React component with page-scoped CSS
  const routes = [];
  let pageCounter = 1;

  for (const page of pages) {
    const srcPath = path.join(sourceDir, page.local_path);
    if (!fs.existsSync(srcPath)) continue;

    const componentName = `Page${pageCounter++}`;

    // Extract page-specific CSS bundle
    const pageCss = extractPageCss(sourceDir, page, pathMapping, { 
      targetCssPath: `src/assets/pages/${componentName}.css`, 
      rootRelative: true 
    }, assets);
    const formattedPageCss = await formatWithPrettier(pageCss, 'css');
    fs.writeFileSync(path.join(pagesCssDir, `${componentName}.css`), formattedPageCss);

    let html = fs.readFileSync(srcPath, 'utf8');
    const $ = cheerio.load(html);

    // Extract root attributes for this page
    const pageHtmlClass = $('html').attr('class') || '';
    const pageHtmlStyle = $('html').attr('style') || '';
    const pageBodyClass = $('body').attr('class') || '';

    $('link[rel="stylesheet"]').remove();
    $('style').remove();
    $('template').remove(); // Remove Next.js RSC streaming placeholders

    let extractedScripts = '';
    $('script').each((_, el) => {
      const src = $(el).attr('src');
      const type = $(el).attr('type');
      const isExecutable = !type || /^(text|application)\/(javascript|ecmascript)$/i.test(type) || type === 'module';
      if (!src && isExecutable) {
        extractedScripts += $(el).html() + '\n';
      }
      $(el).remove();
    });

    let bodyHtml = $('body').html() || '';
    bodyHtml = rewriteHtmlPaths(bodyHtml, reactPathMapping, page.local_path, cloneRecord.url);
    bodyHtml = rewriteLinksToRoutes(bodyHtml, page.local_path);

    const jsxContent = htmlToJsx(bodyHtml);

    let routePath = '/' + page.local_path.replace(/\\/g, '/').replace(/index\.html$/, '').replace(/\.html$/, '');
    if (routePath.endsWith('/') && routePath.length > 1) {
      routePath = routePath.slice(0, -1);
    }
    if (!routePath.startsWith('/')) routePath = '/' + routePath;

    let reactComponent = `import React, { useEffect } from 'react';\n`;
    reactComponent += `import '../assets/pages/${componentName}.css';\n\n`;
    reactComponent += `export default function ${componentName}() {\n`;
    
    // Set page-specific root attributes on mount
    reactComponent += `  useEffect(() => {\n`;
    if (pageHtmlClass) {
      reactComponent += `    document.documentElement.className = ${JSON.stringify(pageHtmlClass)};\n`;
    }
    if (pageHtmlStyle) {
      reactComponent += `    document.documentElement.style.cssText = ${JSON.stringify(pageHtmlStyle)};\n`;
    }
    if (pageBodyClass) {
      reactComponent += `    document.body.className = ${JSON.stringify(pageBodyClass)};\n`;
    }
    reactComponent += `  }, []);\n\n`;

    if (extractedScripts.trim()) {
      reactComponent += `  useEffect(() => {
    try {
      /* Extracted inline scripts */
      ${extractedScripts}
    } catch(e) {
      console.error("Clony: Error running inline script", e);
    }
  }, []);\n\n`;
    }

    reactComponent += `  return (
    <div className="clony-page">
      ${jsxContent}
    </div>
  );
}
`;

    const destPath = path.join(pagesDir, `${componentName}.jsx`);
    fs.writeFileSync(destPath, reactComponent);

    routes.push({
      path: routePath === '' ? '/' : routePath,
      name: componentName,
      importPath: `./pages/${componentName}`
    });
  }

  // 4. Generate App.jsx with route code-splitting
  const appCode = `import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';

${routes.map(r => `const ${r.name} = lazy(() => import('${r.importPath}'));`).join('\n')}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={null}>
        <Routes>
${routes.map(r => `          <Route path="${r.path}" element={<${r.name} />} />`).join('\n')}
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
`;
  fs.writeFileSync(path.join(srcDir, 'App.jsx'), appCode);

  // 5. Generate main.jsx
  fs.writeFileSync(path.join(srcDir, 'main.jsx'), `import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './assets/styles.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
`);

  // 6. Generate index.html with preserved root attributes
  const htmlAttrs = [
    'lang="en"',
    entryHtmlClass ? `class="${entryHtmlClass.replace(/"/g, '&quot;')}"` : '',
    entryHtmlStyle ? `style="${entryHtmlStyle.replace(/"/g, '&quot;')}"` : ''
  ].filter(Boolean).join(' ');

  const bodyAttrs = entryBodyClass ? ` class="${entryBodyClass.replace(/"/g, '&quot;')}"` : '';

  const routeNavigatorHTML = generateRouteNavigatorScript(routes, 'spa');
  const fetchRewriteScript = generateFetchRewriteScript(reactPathMapping);

  fs.writeFileSync(path.join(outputDir, 'index.html'), `<!DOCTYPE html>
<html ${htmlAttrs}>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${cloneRecord.domain}</title>
    ${UNIVERSAL_STUBS_SCRIPT}
    ${fetchRewriteScript}
  </head>
  <body${bodyAttrs}>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
    ${STATIC_INTERACTIVITY_SCRIPT}
    ${routeNavigatorHTML}
  </body>
</html>
`);

  // 7. Generate package.json
  const pkg = {
    name: "clony-react-export",
    version: "1.0.0",
    private: true,
    type: "module",
    scripts: {
      dev: "vite",
      build: "vite build",
      preview: "vite preview"
    },
    dependencies: {
      "react": "^19.0.0",
      "react-dom": "^19.0.0",
      "react-router-dom": "^7.0.0"
    },
    devDependencies: {
      "@vitejs/plugin-react": "^4.2.0",
      "vite": "^5.0.0"
    }
  };
  fs.writeFileSync(path.join(outputDir, 'package.json'), JSON.stringify(pkg, null, 2));

  // 8. Generate vite.config.js
  fs.writeFileSync(path.join(outputDir, 'vite.config.js'), `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
})
`);

  // 9. Generate README.md
  const readme = `# ${cloneRecord.domain} - React Export

This React project was generated by Clony.

## Getting Started

1. Install dependencies:
   \`\`\`bash
   npm install
   \`\`\`

2. Run development server:
   \`\`\`bash
   npm run dev
   \`\`\`

3. Build for production:
   \`\`\`bash
   npm run build
   \`\`\`
`;
  fs.writeFileSync(path.join(outputDir, 'README.md'), readme);
}
