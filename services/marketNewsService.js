/**
 * Tin tức thị trường từ CafeF (cafef.vn).
 * Nếu có FIRECRAWL_API_KEY thì dùng Firecrawl scrape, không thì fallback scrape HTML.
 */
import axios from 'axios';

const CAFEF_LIST_URL = 'https://cafef.vn/thi-truong-chung-khoan.chn';
const FIRECRAWL_API = 'https://api.firecrawl.dev/v1/scrape';

/**
 * Parse HTML CafeF (listing) để lấy danh sách tin: title, url, date, description.
 * Cấu trúc thường: link trong .news-item hoặc tương tự.
 */
function parseCafeFHtml(html) {
  const articles = [];
  if (!html || typeof html !== 'string') return articles;

  // Pattern: link tới cafef.vn với text title, có thể có meta date/desc
  const linkRegex = /<a\s+href="(https?:\/\/cafef\.vn\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const dateRegex = /(\d{1,2}\/\d{1,2}\/\d{4})|(\d{1,2}-\d{1,2}-\d{4})/;
  let m;
  const seen = new Set();

  while ((m = linkRegex.exec(html)) !== null) {
    const url = m[1];
    let rawTitle = m[2].replace(/<[^>]+>/g, '').trim();
    if (!rawTitle || rawTitle.length < 10) continue;
    if (seen.has(url)) continue;
    seen.add(url);

    const title = rawTitle.slice(0, 200);
    const dateMatch = rawTitle.match(dateRegex) || html.slice(Math.max(0, m.index - 200), m.index).match(dateRegex);
    const date = dateMatch ? dateMatch[0] : new Date().toLocaleDateString('vi-VN');

    articles.push({
      title,
      url: url.split('?')[0],
      date,
      description: title.length > 80 ? title.slice(0, 80) + '...' : undefined
    });
  }

  return articles;
}

/**
 * Lấy tin từ CafeF qua Firecrawl (chất lượng tốt hơn).
 */
async function fetchWithFirecrawl(limit, search) {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) return null;

  try {
    const res = await axios.post(
      FIRECRAWL_API,
      { url: CAFEF_LIST_URL, formats: ['markdown'] },
      {
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        timeout: 15000
      }
    );
    const md = res.data?.data?.markdown || res.data?.markdown || '';
    if (!md) return null;

    const lines = md.split('\n').filter((l) => l.trim());
    const articles = [];
    const seen = new Set();

    for (let i = 0; i < lines.length && articles.length < limit; i++) {
      const line = lines[i];
      const linkMatch = line.match(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/);
      if (linkMatch) {
        const title = linkMatch[1].trim();
        const url = linkMatch[2];
        if (!cafef.vn in url) continue;
        if (title.length < 10 || seen.has(url)) continue;
        seen.add(url);
        if (search && !title.toLowerCase().includes(search.toLowerCase())) continue;
        articles.push({
          title: title.slice(0, 200),
          url,
          date: new Date().toLocaleDateString('vi-VN'),
          description: title.length > 80 ? title.slice(0, 80) + '...' : undefined
        });
      }
    }
    return articles;
  } catch (e) {
    if (process.env.LOG_LEVEL === 'debug') console.error('[marketNews] Firecrawl:', e.message);
    return null;
  }
}

/**
 * Fallback: axios get HTML CafeF và parse.
 */
async function fetchWithAxios(limit, search) {
  try {
    const res = await axios.get(CAFEF_LIST_URL, {
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Bot/1.0)' }
    });
    const html = res.data;
    let articles = parseCafeFHtml(html);
    if (search) {
      const q = search.toLowerCase();
      articles = articles.filter((a) => a.title.toLowerCase().includes(q));
    }
    return articles.slice(0, limit);
  } catch (e) {
    if (process.env.LOG_LEVEL === 'debug') console.error('[marketNews] Axios:', e.message);
    return [];
  }
}

/**
 * @param {object} opts - { limit, search, format }
 * @returns {Promise<{ success: boolean, articles: Array }>}
 */
export async function getNews(opts = {}) {
  const limit = Math.min(100, Math.max(1, Number(opts.limit) || 30));
  const search = typeof opts.search === 'string' ? opts.search.trim() : '';

  let articles = await fetchWithFirecrawl(limit, search);
  if (!articles || articles.length === 0) {
    articles = await fetchWithAxios(limit, search);
  }

  return {
    success: true,
    articles: articles || []
  };
}

export default { getNews };
