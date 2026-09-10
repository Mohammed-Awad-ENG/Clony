const cheerio = require('cheerio');
const fs = require('fs');

const html = fs.readFileSync('clones/5c9ed101-5210-428b-88cd-5ae3d4f89a10/index.html', 'utf8');
const $ = cheerio.load(html);

console.log("body > div > div:");
console.log($('body > div > div').first().html() || "No content");
console.log("\nbody > div > div classes:", $('body > div > div').first().attr('class'));

