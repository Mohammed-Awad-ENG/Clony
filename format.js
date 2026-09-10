const fs = require('fs');
const html = fs.readFileSync('scratch/preview.html', 'utf8');
const formatted = html.replace(/></g, '>\n<');
fs.writeFileSync('scratch/preview_formatted.html', formatted);
