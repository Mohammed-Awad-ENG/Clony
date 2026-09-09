import postcss from 'postcss';
import postcssUrl from 'postcss-url';

export async function rewriteCssUrls(cssContent, cssUrl, rewriteCallback) {
  try {
    const result = await postcss([
      postcssUrl({
        url: function(asset) {
          if (!asset.url || asset.url.startsWith('data:')) {
            return asset.url;
          }
          // Resolve absolute URL
          const absoluteUrl = new URL(asset.url, cssUrl).href;
          const rewrittenPath = rewriteCallback(absoluteUrl);
          return rewrittenPath || asset.url;
        }
      })
    ]).process(cssContent, { from: undefined });
    
    return result.css;
  } catch (err) {
    console.error('Error rewriting CSS:', err);
    return cssContent;
  }
}
