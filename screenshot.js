const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto('http://localhost:5173/#/preview/5c9ed101-5210-428b-88cd-5ae3d4f89a10', { waitUntil: 'networkidle2' });
  
  // Wait a bit for iframe to load
  await new Promise(r => setTimeout(r, 3000));
  
  await page.screenshot({ path: 'clony_preview.png' });
  await browser.close();
})();
