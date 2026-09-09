let currentLocale = localStorage.getItem('clony_locale') || 'en';
let translations = {};

export async function initI18n() {
  await loadLocale(currentLocale);
  applyTranslations();
  setDocumentDirection(currentLocale);
}

export async function loadLocale(locale) {
  try {
    const response = await fetch(`/locales/${locale}.json`);
    if (!response.ok) throw new Error('Locale not found');
    translations = await response.json();
    currentLocale = locale;
    localStorage.setItem('clony_locale', locale);
    setDocumentDirection(locale);
  } catch (e) {
    console.error('Failed to load locale:', locale, e);
  }
}

export function t(key) {
  return translations[key] || key;
}

export function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (translations[key]) {
      if (el.tagName === 'INPUT' && el.type === 'text') {
        el.placeholder = translations[key];
      } else {
        el.textContent = translations[key];
      }
    }
  });
}

function setDocumentDirection(locale) {
  const isRtl = locale === 'ar';
  document.documentElement.dir = isRtl ? 'rtl' : 'ltr';
  document.documentElement.lang = locale;
}

export function getCurrentLocale() {
  return currentLocale;
}
