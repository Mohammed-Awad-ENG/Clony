const fs = require('fs');
const html = fs.readFileSync('clones/5c9ed101-5210-428b-88cd-5ae3d4f89a10/pro/agent-kit/index.html', 'utf8');

// Find where the modal is!
const cheerio = require('cheerio');
const $ = cheerio.load(html);
$('body').children().each((i, el) => {
  if (el.tagName !== 'script') {
     console.log(i, el.tagName, $(el).attr('class') || $(el).attr('id'));
  }
});

