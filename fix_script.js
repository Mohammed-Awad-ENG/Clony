const fs = require('fs');
let code = fs.readFileSync('server/services/exports/exportUtils.js', 'utf8');

const newScript = `export const STATIC_INTERACTIVITY_SCRIPT = \`
<script>
  /* Clony: Generic interactivity for static exports (popup dismissal) */
  document.addEventListener('DOMContentLoaded', () => {
    
    function cleanupModal(target) {
      target.style.display = 'none';
      
      // Stop any media playing inside the dismissed container
      const mediaElements = target.querySelectorAll('video, audio');
      mediaElements.forEach(media => {
        if (typeof media.pause === 'function') media.pause();
      });
      const iframes = target.querySelectorAll('iframe');
      iframes.forEach(iframe => {
        const src = iframe.src;
        iframe.src = src; // Reload iframe to stop playing media
      });
      
      // Restore body scrolling if it was locked by the modal
      if (document.body.style.overflow === 'hidden' || document.body.style.position === 'fixed') {
        document.body.style.overflow = '';
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.width = '';
      }
    }

    document.addEventListener('click', function(e) {
      let target = e.target;
      
      // 1. Backdrop click detection
      if (target && target !== document.body && target.tagName !== 'HTML') {
        const style = window.getComputedStyle(target);
        const cName = (typeof target.className === 'string' ? target.className : '').toLowerCase();
        if (
          (style.position === 'fixed' || style.position === 'absolute') && 
          (cName.includes('overlay') || cName.includes('backdrop') || cName.includes('modal-wrapper') || style.backgroundColor.startsWith('rgba'))
        ) {
           if (e.target === target) {
              cleanupModal(target);
              return;
           }
        }
      }

      // 2. Close button click detection
      while (target && target !== document.body) {
        if (target.tagName === 'A' && target.getAttribute('href') && target.getAttribute('href').startsWith('#')) {
          return;
        }
        
        const isButton = target.tagName === 'BUTTON' || target.getAttribute('role') === 'button';
        const text = (target.textContent || '').trim().toLowerCase();
        const ariaLabel = (target.getAttribute('aria-label') || '').toLowerCase();
        const className = (typeof target.className === 'string' ? target.className : '').toLowerCase();
        
        const isClose = ariaLabel.includes('close') || ariaLabel.includes('dismiss') || 
                        className.includes('close') || className.includes('dismiss') ||
                        (isButton && (text === 'x' || text === 'close' || text === 'dismiss'));
                        
        if (isClose) {
          let container = target.parentElement;
          let containerToHide = null;
          
          while (container && container !== document.body && container.tagName !== 'HTML') {
            const style = window.getComputedStyle(container);
            const cName = (typeof container.className === 'string' ? container.className : '').toLowerCase();
            const role = container.getAttribute('role');
            
            if (container.tagName === 'HEADER' || container.tagName === 'NAV') {
               break; 
            }
            
            if (
              style.position === 'fixed' || 
              container.tagName === 'DIALOG' || 
              role === 'dialog' || 
              role === 'alertdialog' || 
              cName.includes('modal') || 
              cName.includes('popup') || 
              cName.includes('overlay') ||
              cName.includes('toast') ||
              cName.includes('backdrop')
            ) {
              containerToHide = container;
            }
            container = container.parentElement;
          }
          
          if (containerToHide) {
            cleanupModal(containerToHide);
          }
          break;
        }
        
        target = target.parentElement;
      }
    });
  });
</script>
\`;`;

// Find everything from "export const STATIC_INTERACTIVITY_SCRIPT = `" to the end of the script string
const startIdx = code.indexOf('export const STATIC_INTERACTIVITY_SCRIPT = `');
const endIdx = code.indexOf('</script>\n`;', startIdx);

if (startIdx !== -1 && endIdx !== -1) {
  code = code.substring(0, startIdx) + newScript + code.substring(endIdx + ('</script>\n`;').length);
  fs.writeFileSync('server/services/exports/exportUtils.js', code);
  console.log("Successfully replaced script.");
} else {
  console.log("Could not find script bounds.");
}
