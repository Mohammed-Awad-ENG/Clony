import fs from 'fs';
import path from 'path';
import * as cheerio from 'cheerio';
import { 
  buildAssetRenameMap, 
  copyAssetsOrganized, 
  rewriteHtmlPaths, 
  mergeCss, 
  formatWithPrettier,
  STATIC_INTERACTIVITY_SCRIPT
} from './exportUtils.js';
import { htmlToJsx } from './htmlToJsx.js';

export async function generate(sourceDir, outputDir, cloneRecord, pages, assets) {
  const publicDir = path.join(outputDir, 'public');
  const srcDir = path.join(outputDir, 'src');
  const pagesDir = path.join(srcDir, 'pages');
  const assetsDir = path.join(srcDir, 'assets');

  [publicDir, srcDir, pagesDir, assetsDir].forEach(d => fs.mkdirSync(d, { recursive: true }));

  // 1. Build rename map and copy assets to public/
  const renameMap = buildAssetRenameMap(assets);
  const pathMapping = copyAssetsOrganized(sourceDir, publicDir, assets, renameMap);
  
  const reactPathMapping = new Map();
  for (const [key, value] of pathMapping) {
    reactPathMapping.set(key, '/' + value.replace(/\\/g, '/'));
  }

  // 2. Merge CSS
  const mergedCss = mergeCss(sourceDir, assets, pages, pathMapping);
  const formattedCss = await formatWithPrettier(mergedCss, 'css');
  fs.writeFileSync(path.join(assetsDir, 'styles.css'), formattedCss);

  // 3. Process each HTML page to React component
  const routes = [];
  let pageCounter = 1;

  for (const page of pages) {
    const srcPath = path.join(sourceDir, page.local_path);
    if (!fs.existsSync(srcPath)) continue;

    let html = fs.readFileSync(srcPath, 'utf8');
    const $ = cheerio.load(html);

    $('link[rel="stylesheet"]').remove();
    $('style').remove();

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

    const jsxContent = htmlToJsx(bodyHtml);

    const componentName = `Page${pageCounter++}`;
    let routePath = '/' + page.local_path.replace(/\\/g, '/').replace(/index\.html$/, '').replace(/\.html$/, '');
    if (routePath.endsWith('/') && routePath.length > 1) {
      routePath = routePath.slice(0, -1);
    }
    if (!routePath.startsWith('/')) routePath = '/' + routePath;

    let reactComponent = `import React, { useEffect } from 'react';\n\n`;
    reactComponent += `export default function ${componentName}() {\n`;
    
    if (extractedScripts.trim()) {
      // Notice we are NOT using the unsafe regex replace here since it's plain JS in a string literal, 
      // but we do need to avoid syntax errors if there are backticks.
      // Wait, we can just dump the code as-is because it's not a template literal anymore!
      // But if there are nested closures or strict mode issues, it might throw. We wrap in try/catch.
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

  // 4. Generate App.jsx
  const appCode = `import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './assets/styles.css';

${routes.map(r => `import ${r.name} from '${r.importPath}';`).join('\n')}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
${routes.map(r => `        <Route path="${r.path}" element={<${r.name} />} />`).join('\n')}
      </Routes>
    </BrowserRouter>
  );
}
`;
  fs.writeFileSync(path.join(srcDir, 'App.jsx'), appCode);

  // 5. Generate main.jsx
  fs.writeFileSync(path.join(srcDir, 'main.jsx'), `import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
`);

  // 6. Generate index.html
  fs.writeFileSync(path.join(outputDir, 'index.html'), `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${cloneRecord.domain}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
    ${STATIC_INTERACTIVITY_SCRIPT}
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
