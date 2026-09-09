import robotsParser from 'robots-parser';

export async function parseRobotsTxt(baseUrl) {
  try {
    const urlObj = new URL(baseUrl);
    const robotsUrl = `${urlObj.origin}/robots.txt`;
    const response = await fetch(robotsUrl, {
      headers: {
        'User-Agent': 'ClonyWebCrawler/1.0'
      }
    });

    if (response.ok) {
      const text = await response.text();
      return robotsParser(robotsUrl, text);
    }
  } catch (error) {
    console.error(`Error fetching robots.txt for ${baseUrl}:`, error.message);
  }
  return null;
}

export function isAllowed(robots, urlStr, userAgent = 'ClonyWebCrawler/1.0') {
  if (!robots) return true; // If no robots.txt, default to allowed
  return robots.isAllowed(urlStr, userAgent) !== false;
}
