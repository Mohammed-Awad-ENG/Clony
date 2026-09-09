import { t } from '../i18n.js';

export class Disclaimer {
  render() {
    const footer = document.createElement('footer');
    footer.className = 'app-disclaimer';
    footer.style.cssText = `
      margin-top: 2rem;
      padding: 1rem;
      text-align: center;
      font-size: 0.8rem;
      color: var(--text-secondary);
      border-top: 1px solid var(--border);
    `;
    
    footer.innerHTML = `
      <div class="container">
        <p data-i18n="disclaimer_text">${t('disclaimer_text')}</p>
      </div>
    `;
    
    return footer;
  }
}
