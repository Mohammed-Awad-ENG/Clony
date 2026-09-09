import { URL } from 'url';
import normalizeUrl from 'normalize-url';

export function normalize(urlStr) {
  try {
    return normalizeUrl(urlStr, {
      stripHash: true,
      removeTrailingSlash: true,
      removeQueryParameters: [/^utm_/, /^fbclid$/, /^ref$/],
    });
  } catch (e) {
    return null;
  }
}

export function isSameDomain(baseUrlStr, targetUrlStr) {
  try {
    const base = new URL(baseUrlStr);
    const target = new URL(targetUrlStr);
    // Allow subdomains if crawling the root domain, or require exact match
    return target.hostname === base.hostname || target.hostname.endsWith('.' + base.hostname);
  } catch (e) {
    return false;
  }
}

export function getDomain(urlStr) {
  try {
    return new URL(urlStr).hostname;
  } catch (e) {
    return 'unknown_domain';
  }
}
