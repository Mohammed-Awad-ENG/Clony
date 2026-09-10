import fs from 'fs';
import * as cheerio from 'cheerio';

const html = fs.readFileSync('scratch/preview.html', 'utf8');
const $ = cheerio.load(html);

console.log("SVG count in category-page:", $('.category-page svg').length);
$('.category-page svg').each((i, el) => {
   console.log("SVG", i, "classes:", $(el).attr('class'));
});

