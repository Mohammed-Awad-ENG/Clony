import * as cheerio from 'cheerio';
import fs from 'fs';

const html = fs.readFileSync('clones/5c9ed101-5210-428b-88cd-5ae3d4f89a10/index.html', 'utf8');
const $ = cheerio.load(html);

$('video').each((i, el) => {
  console.log($(el).attr('src') || 'no-src', 'muted:', $(el).attr('muted'));
});
