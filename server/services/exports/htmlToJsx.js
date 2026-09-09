import * as cheerio from 'cheerio';

const ATTR_MAP = {
  'class': 'className',
  'for': 'htmlFor',
  'tabindex': 'tabIndex',
  'colspan': 'colSpan',
  'rowspan': 'rowSpan',
  'readonly': 'readOnly',
  'maxlength': 'maxLength',
  'autocomplete': 'autoComplete',
  'autofocus': 'autoFocus',
  'contenteditable': 'contentEditable',
  'spellcheck': 'spellCheck',
  'srclang': 'srcLang',
  'srcset': 'srcSet',
  'usemap': 'useMap',
  'datetime': 'dateTime',
  'playsinline': 'playsInline',
  'crossorigin': 'crossOrigin',
  'fill-rule': 'fillRule',
  'stroke-width': 'strokeWidth',
  'stroke-linecap': 'strokeLinecap',
  'stroke-linejoin': 'strokeLinejoin',
  'stroke-miterlimit': 'strokeMiterlimit',
  'clip-rule': 'clipRule',
  'clip-path': 'clipPath',
  'viewbox': 'viewBox',
};

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 
  'input', 'link', 'meta', 'source', 'track', 'wbr'
]);

function parseStyle(styleStr) {
  const styles = {};
  const rules = styleStr.split(';');
  for (const rule of rules) {
    const colonIndex = rule.indexOf(':');
    if (colonIndex > -1) {
      const key = rule.slice(0, colonIndex).trim();
      const value = rule.slice(colonIndex + 1).trim();
      if (key && value) {
        let camelKey = key.replace(/-([a-z])/g, g => g[1].toUpperCase());
        // Handle ms prefixes
        if (camelKey.startsWith('ms')) {
          camelKey = 'ms' + camelKey.charAt(2).toUpperCase() + camelKey.slice(3);
        }
        styles[camelKey] = value;
      }
    }
  }
  return styles;
}

export function htmlToJsx(html) {
  const $ = cheerio.load(html, null, false);
  let jsxContent = '';

  function nodeToJsx(node) {
    if (node.type === 'text') {
      let text = node.data;
      if (!text.trim()) return text; // keep whitespace as is mostly
      // Escape JSX special chars in a single pass to prevent recursive replacement bugs
      text = text.replace(/[{}]/g, match => match === '{' ? "{'{'}" : "{'}'}");
      // In JSX, literal < and > inside text can sometimes cause issues if not escaped, 
      // but cheerio usually escapes them in .html(), in text they are literal.
      text = text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
      return text;
    }

    if (node.type === 'comment') {
      return `{/* ${node.data.replace(/\*\//g, '* /')} */}`;
    }

    if (node.type === 'script') {
      const innerHtml = $(node).html() || '';
      const safeHtml = innerHtml.replace(/`/g, '\\`').replace(/\$/g, '\\$');
      
      let tag = '<script';
      for (const [key, value] of Object.entries(node.attribs)) {
        if (key.startsWith('on')) continue;
        const jsxKey = ATTR_MAP[key.toLowerCase()] || key;
        tag += ` ${jsxKey}=${JSON.stringify(value)}`;
      }
      
      if (!safeHtml.trim()) {
        return tag + '></script>';
      }
      
      return tag + ` dangerouslySetInnerHTML={{ __html: \`${safeHtml}\` }}></script>`;
    }

    if (node.type === 'tag' || node.type === 'style') {
      let tag = node.name;
      let jsx = `<${tag}`;

      // Process attributes
      for (const [key, value] of Object.entries(node.attribs)) {
        if (key.startsWith('on')) continue;

        const lowerKey = key.toLowerCase();
        let jsxKey = ATTR_MAP[lowerKey] || key;
        
        // Convert dash-case data attributes to camelCase? No, data-* and aria-* should remain hyphenated in React
        if (jsxKey.startsWith('data-') || jsxKey.startsWith('aria-')) {
          // Keep as is
        } else if (jsxKey.includes('-')) {
          jsxKey = jsxKey.replace(/-([a-z])/g, g => g[1].toUpperCase());
        }

        if (lowerKey === 'style') {
          const styleObj = parseStyle(value);
          jsx += ` style={${JSON.stringify(styleObj)}}`;
        } else if (value === '' || value === key) {
          jsx += ` ${jsxKey}`;
        } else {
          jsx += ` ${jsxKey}=${JSON.stringify(value)}`;
        }
      }

      if (VOID_ELEMENTS.has(tag.toLowerCase())) {
        jsx += ` />`;
      } else {
        jsx += `>`;
        for (const child of node.children) {
          jsx += nodeToJsx(child);
        }
        jsx += `</${tag}>`;
      }
      return jsx;
    }

    return '';
  }

  // Iterate over root nodes
  $.root().contents().each((_, el) => {
    jsxContent += nodeToJsx(el);
  });

  // If there are multiple root elements, wrap in a fragment
  const roots = $.root().children();
  if (roots.length > 1 || (roots.length === 1 && $.root().contents().length > 1)) {
    return `<>\n${jsxContent}\n</>`;
  }

  return jsxContent;
}
