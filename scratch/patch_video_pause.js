const fs = require('fs');
let code = fs.readFileSync('server/services/exports/exportUtils.js', 'utf8');

const targetStr = "containerToHide.style.display = 'none';";
const replacementStr = `containerToHide.style.display = 'none';
            // Clony: Stop any media playing inside the dismissed container
            const mediaElements = containerToHide.querySelectorAll('video, audio');
            mediaElements.forEach(media => {
              if (typeof media.pause === 'function') media.pause();
            });
            const iframes = containerToHide.querySelectorAll('iframe');
            iframes.forEach(iframe => {
              const src = iframe.src;
              iframe.src = src; // Reload iframe to stop playing media
            });`;

code = code.replace(targetStr, replacementStr);

fs.writeFileSync('server/services/exports/exportUtils.js', code);
