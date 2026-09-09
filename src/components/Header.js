import { t, loadLocale, getCurrentLocale, applyTranslations } from '../i18n.js';

export class Header {
  render() {
    const header = document.createElement('header');
    header.className = 'app-header container';
    
    header.innerHTML = `
      <div class="logo">
        <span data-i18n="app_name">${t('app_name')}</span>
      </div>
      <nav class="nav-links">
        <a href="#/" data-i18n="nav_clone">${t('nav_clone')}</a>
        <a href="#/library" data-i18n="nav_library">${t('nav_library')}</a>
      </nav>
      <div class="header-actions">
        <button id="lang-toggle" class="btn btn-secondary">
          ${getCurrentLocale() === 'en' ? 'العربية' : 'English'}
        </button>
      </div>
    `;

    const langToggle = header.querySelector('#lang-toggle');
    langToggle.addEventListener('click', async () => {
      const newLocale = getCurrentLocale() === 'en' ? 'ar' : 'en';
      await loadLocale(newLocale);
      applyTranslations();
      langToggle.textContent = newLocale === 'en' ? 'العربية' : 'English';
    });

    return header;
  }
}
