import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.toString()));
  
  // Navigate to the preview URL for the text loop clone
  await page.goto('http://localhost:3000/api/preview/5c9ed101-5210-428b-88cd-5ae3d4f89a10/text-animations/text-loop/index.html', { waitUntil: 'networkidle2' });
  
  // Give it 3 seconds
  await new Promise(r => setTimeout(r, 3000));
  
  const bodyStyle = await page.evaluate(() => {
    return {
       position: document.body.style.position,
       top: document.body.style.top,
       overflow: document.body.style.overflow
    };
  });
  console.log("Body styles before click:", bodyStyle);
  
  // Try to click the close button
  await page.evaluate(() => {
    const btn = document.querySelector('.announcement-modal-close');
    if (btn) btn.click();
  });
  
  // Wait 1 second
  await new Promise(r => setTimeout(r, 1000));
  
  const bodyStyleAfter = await page.evaluate(() => {
    return {
       position: document.body.style.position,
       top: document.body.style.top,
       overflow: document.body.style.overflow
    };
  });
  console.log("Body styles after click:", bodyStyleAfter);
  
  await browser.close();
})();
