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
  generateRouteNavigatorScript,
  generateFetchRewriteScript
} from './exportUtils.js';

export async function generate(sourceDir, outputDir, cloneRecord, pages, assets) {
  const publicDir = path.join(outputDir, 'public');
  const srcDir = path.join(outputDir, 'src');
  const viewsDir = path.join(srcDir, 'views');
  const assetsDir = path.join(srcDir, 'assets');
  const routerDir = path.join(srcDir, 'router');

  [publicDir, srcDir, viewsDir, assetsDir, routerDir].forEach(d => fs.mkdirSync(d, { recursive: true }));

  // 1. Build rename map and copy assets to public/
  const renameMap = buildAssetRenameMap(assets);
  const pathMapping = copyAssetsOrganized(sourceDir, publicDir, assets, renameMap);
  
  // Create mapping with absolute paths for Vue public directory
  const vuePathMapping = new Map();
  for (const [key, value] of pathMapping) {
    vuePathMapping.set(key, '/' + value.replace(/\\/g, '/'));
  }

  // 2. Merge CSS
  const mergedCss = mergeCss(sourceDir, assets, pages, pathMapping);
  const formattedCss = await formatWithPrettier(mergedCss, 'css');
  fs.writeFileSync(path.join(assetsDir, 'styles.css'), formattedCss);

  // 3. Process each HTML page to Vue component
  const routes = [];
  let pageCounter = 1;

  for (const page of pages) {
    const srcPath = path.join(sourceDir, page.local_path);
    if (!fs.existsSync(srcPath)) continue;

    let html = fs.readFileSync(srcPath, 'utf8');
    const $ = cheerio.load(html);

    $('link[rel="stylesheet"]').remove();
    $('style').remove();
    $('template').remove(); // Remove Next.js RSC streaming placeholders

    // Extract inline scripts
    let extractedScripts = '';
    $('script').each((_, el) => {
      const src = $(el).attr('src');
      const type = $(el).attr('type');
      const isExecutable = !type || /^(text|application)\/(javascript|ecmascript)$/i.test(type) || type === 'module';
      if (!src && isExecutable) {
        extractedScripts += $(el).html() + '\n';
      }
      // Vue templates don't allow script tags inside them
      $(el).remove();
    });

    let bodyHtml = $('body').html() || '';
    bodyHtml = rewriteHtmlPaths(bodyHtml, vuePathMapping, page.local_path, cloneRecord.url);
    bodyHtml = rewriteLinksToRoutes(bodyHtml, page.local_path);

    const componentName = `Page${pageCounter++}`;
    let routePath = '/' + page.local_path.replace(/\\/g, '/').replace(/index\.html$/, '').replace(/\.html$/, '');
    if (routePath.endsWith('/') && routePath.length > 1) {
      routePath = routePath.slice(0, -1);
    }
    if (!routePath.startsWith('/')) routePath = '/' + routePath;

    let vueComponent = `<template>\n  <div class="clony-page" v-pre>\n    ${bodyHtml}\n  </div>\n</template>\n\n`;
    
    if (extractedScripts.trim()) {
      vueComponent += `<script setup>
import { onMounted } from 'vue';

onMounted(() => {
  try {
    /* Extracted inline scripts */
    ${extractedScripts.replace(/<\/script>/gi, '<\\/script>')}
  } catch(e) {
    console.error("Clony: Error running inline script", e);
  }
});
</script>\n`;
    }

    const destPath = path.join(viewsDir, `${componentName}.vue`);
    fs.writeFileSync(destPath, vueComponent);

    routes.push({
      path: routePath,
      name: componentName,
      component: componentName
    });
  }

  // 4. Generate router/index.js
  const routerCode = `import { createRouter, createWebHistory } from 'vue-router';
${routes.map(r => `import ${r.name} from '../views/${r.name}.vue';`).join('\n')}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
${routes.map(r => `    { path: '${r.path === '' ? '/' : r.path}', name: '${r.name}', component: ${r.name} }`).join(',\n')}
  ]
});

export default router;
`;
  fs.writeFileSync(path.join(routerDir, 'index.js'), routerCode);

  // 5. Generate App.vue
  fs.writeFileSync(path.join(srcDir, 'App.vue'), `<template>
  <router-view />
</template>

<script setup>
</script>
`);

  // 6. Generate main.js
  fs.writeFileSync(path.join(srcDir, 'main.js'), `import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import './assets/styles.css'

const app = createApp(App)
app.use(router)
app.mount('#app')
`);

  // 7. Generate index.html
  const routeNavigatorHTML = generateRouteNavigatorScript(routes, 'spa');
  const fetchRewriteScript = generateFetchRewriteScript(vuePathMapping);
  
  fs.writeFileSync(path.join(outputDir, 'index.html'), `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${cloneRecord.domain}</title>
    ${UNIVERSAL_STUBS_SCRIPT}
    ${fetchRewriteScript}
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.js"></script>
    ${STATIC_INTERACTIVITY_SCRIPT}
    ${routeNavigatorHTML}
  </body>
</html>
`);

  // 8. Generate package.json
  const pkg = {
    name: "clony-vue-export",
    version: "1.0.0",
    private: true,
    scripts: {
      dev: "vite",
      build: "vite build",
      preview: "vite preview"
    },
    dependencies: {
      "vue": "^3.4.0",
      "vue-router": "^4.2.0"
    },
    devDependencies: {
      "@vitejs/plugin-vue": "^5.0.0",
      "vite": "^5.0.0"
    }
  };
  fs.writeFileSync(path.join(outputDir, 'package.json'), JSON.stringify(pkg, null, 2));

  // 9. Generate vite.config.js
  fs.writeFileSync(path.join(outputDir, 'vite.config.js'), `import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
})
`);

  // 10. Generate README.md
  const readme = `# ${cloneRecord.domain} - Vue Export

This Vue 3 project was generated by Clony.

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
