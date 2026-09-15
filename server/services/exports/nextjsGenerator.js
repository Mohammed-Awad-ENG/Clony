import fs from 'fs';
import path from 'path';
import * as cheerio from 'cheerio';
import { 
  buildAssetRenameMap, 
  copyAssetsOrganized, 
  rewriteHtmlPaths, 
  mergeCss, 
  formatWithPrettier,
  rewriteLinksToRoutes,
  STATIC_INTERACTIVITY_SCRIPT,
  UNIVERSAL_STUBS_SCRIPT,
  generateRouteNavigatorScript
} from './exportUtils.js';
import { htmlToJsx } from './htmlToJsx.js';

export async function generate(sourceDir, outputDir, cloneRecord, pages, assets) {
  const publicDir = path.join(outputDir, 'public');
  const srcDir = path.join(outputDir, 'src');
  const appDir = path.join(srcDir, 'app');

  [publicDir, srcDir, appDir].forEach(d => fs.mkdirSync(d, { recursive: true }));

  // 1. Build rename map and copy assets to public/
  const renameMap = buildAssetRenameMap(assets);
  const pathMapping = copyAssetsOrganized(sourceDir, publicDir, assets, renameMap);
  
  const nextPathMapping = new Map();
  for (const [key, value] of pathMapping) {
    nextPathMapping.set(key, '/' + value.replace(/\\/g, '/'));
  }

  // 2. Merge CSS
  const mergedCss = mergeCss(sourceDir, assets, pages, pathMapping);
  const formattedCss = await formatWithPrettier(mergedCss, 'css');
  fs.writeFileSync(path.join(appDir, 'globals.css'), formattedCss);

  // 3. Process each HTML page to Next.js route
  for (const page of pages) {
    const srcPath = path.join(sourceDir, page.local_path);
    if (!fs.existsSync(srcPath)) continue;

    let html = fs.readFileSync(srcPath, 'utf8');
    const $ = cheerio.load(html);

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
    bodyHtml = rewriteHtmlPaths(bodyHtml, nextPathMapping, page.local_path, cloneRecord.url);
    bodyHtml = rewriteLinksToRoutes(bodyHtml, page.local_path);

    const jsxContent = htmlToJsx(bodyHtml);

    let routeDir = page.local_path.replace(/\\/g, '/');
    if (routeDir === 'index.html') {
      routeDir = '';
    } else if (routeDir.endsWith('/index.html')) {
      routeDir = routeDir.slice(0, -11);
    } else if (routeDir.endsWith('.html')) {
      routeDir = routeDir.slice(0, -5);
    }

    const pageDir = path.join(appDir, routeDir);
    fs.mkdirSync(pageDir, { recursive: true });

    let nextComponent = `'use client';\n\nimport React, { useEffect } from 'react';\n\n`;
    nextComponent += `export default function Page() {\n`;
    
    if (extractedScripts.trim()) {
      nextComponent += `  useEffect(() => {
    try {
      /* Extracted inline scripts */
      ${extractedScripts.replace(/<\/script>/gi, '<\/script>')}
    } catch(e) {
      console.error("Clony: Error running inline script", e);
    }
  }, []);\n\n`;
    }

    nextComponent += `  return (
    <div className="clony-page">
      ${jsxContent}
    </div>
  );
}
`;

    fs.writeFileSync(path.join(pageDir, 'page.jsx'), nextComponent);
  }

  // 4. Generate layout.jsx
  const rawScript = STATIC_INTERACTIVITY_SCRIPT.replace(/<script>|<\/script>/g, '').trim();
  const routeNavigatorHTML = generateRouteNavigatorScript(routes, 'spa');
  
  const layoutCode = `import './globals.css'

export const metadata = {
  title: '${cloneRecord.domain}',
  description: 'Cloned by Clony from ${cloneRecord.url}',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <script dangerouslySetInnerHTML={{ __html: \`${UNIVERSAL_STUBS_SCRIPT.replace(/<script>|<\/script>/gi, '').trim().replace(/`/g, '\\`').replace(/\\$/g, '\\\\$')}\` }} />
        {children}
        <script dangerouslySetInnerHTML={{ __html: \`${rawScript.replace(/`/g, '\\`').replace(/\\$/g, '\\\\$')}\` }} />
        <div dangerouslySetInnerHTML={{ __html: \`${routeNavigatorHTML.replace(/`/g, '\\`').replace(/\\$/g, '\\\\$')}\` }} />
      </body>
    </html>
  )
}
`;
  fs.writeFileSync(path.join(appDir, 'layout.jsx'), layoutCode);

  // 5. Generate package.json
  const pkg = {
    name: "clony-nextjs-export",
    version: "1.0.0",
    private: true,
    scripts: {
      dev: "next dev",
      build: "next build",
      start: "next start"
    },
    dependencies: {
      "next": "15.0.0",
      "react": "19.0.0",
      "react-dom": "19.0.0"
    }
  };
  fs.writeFileSync(path.join(outputDir, 'package.json'), JSON.stringify(pkg, null, 2));

  // 6. Generate next.config.mjs
  fs.writeFileSync(path.join(outputDir, 'next.config.mjs'), `/** @type {import('next').NextConfig} */
const nextConfig = {};

export default nextConfig;
`);

  // 7. Generate README.md
  const readme = `# ${cloneRecord.domain} - Next.js Export

This Next.js 15 project was generated by Clony.

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
