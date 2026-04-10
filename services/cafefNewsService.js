/**
 * Tin tức thị trường chứng khoán từ CafeF (cafef.vn).
 * Tích hợp logic từ vn-stock-api-mcp: dùng Firecrawl API nếu có key, fallback scrape HTML.
 */

const CAFEF_URL = 'https://cafef.vn/thi-truong-chung-khoan.chn';
const FIRECRAWL_API_URL = 'https://api.firecrawl.dev/v1/scrape';

/**
 * Lấy tin CafeF: ưu tiên Firecrawl, không có key thì fetch HTML và parse.
 * @param {Object} options
 * @param {number} [options.limit=20] - Số tin tối đa (max 100)
 * @param {string} [options.search] - Từ khóa lọc (title, description)
 * @param {string} [options.format='json'] - 'json' | 'markdown' | 'text'
 * @returns {Promise<{ source: string, url: string, total: number, articles: Array, timestamp: string }>}
 */
export async function getCafefMarketNews(options = {}) {
  const { limit = 20, search, format = 'json' } = options;
  const maxLimit = Math.min(Math.max(1, Number(limit) || 20), 100);

  try {
    const firecrawlApiKey = process.env.FIRECRAWL_API_KEY || '';

    if (firecrawlApiKey) {
      try {
        const response = await fetch(FIRECRAWL_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${firecrawlApiKey}`,
          },
          body: JSON.stringify({
            url: CAFEF_URL,
            formats: ['markdown'],
            onlyMainContent: true,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          const markdown = data.data?.markdown || data.markdown || '';
          const articles = parseCafefMarkdown(markdown, maxLimit, search);
          return buildResponse(articles, format);
        }
      } catch (err) {
        console.warn('Firecrawl API error, using fallback:', err?.message);
      }
    }

    return await getCafefNewsFallback(CAFEF_URL, maxLimit, search, format);
  } catch (error) {
    console.error('CafeF news error:', error);
    throw error;
  }
}

async function getCafefNewsFallback(url, limit, search, format = 'json') {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
    },
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const html = await response.text();
  const articles = parseCafefHTML(html, limit, search);
  return buildResponse(Array.isArray(articles) ? articles : [], format);
}

function buildResponse(articles, format) {
  const payload = {
    source: 'CafeF (cafef.vn)',
    url: CAFEF_URL,
    total: articles.length,
    articles: articles.map((a) => ({
      title: a.title,
      url: a.url,
      date: a.date,
      description: a.description || '',
    })),
    timestamp: new Date().toISOString(),
  };

  if (format === 'json') {
    return payload;
  }

  if (format === 'markdown') {
    const lines = [
      '# Tin tức thị trường chứng khoán từ CafeF',
      '',
      ...articles.map(
        (a, i) =>
          `## ${i + 1}. ${a.title}\n\n**Ngày:** ${a.date}\n\n**Mô tả:** ${a.description || 'N/A'}\n\n**Link:** ${a.url}\n\n---`
      ),
    ];
    return { ...payload, markdown: lines.join('\n\n') };
  }

  if (format === 'text') {
    const text = articles
      .map(
        (a, i) =>
          `${i + 1}. ${a.title}\nNgày: ${a.date}\n${a.description || ''}\nLink: ${a.url}\n`
      )
      .join('\n');
    return { ...payload, text };
  }

  return payload;
}

function parseCafefMarkdown(markdown, limit, search) {
  const articles = [];
  const lines = markdown.split('\n');
  let currentArticle = null;

  for (let i = 0; i < lines.length && articles.length < limit; i++) {
    const line = lines[i].trim();

    const headingMatch = line.match(/^###?\s+\[(.+)\]\((.+)\)/);
    if (headingMatch) {
      if (currentArticle) articles.push(currentArticle);
      currentArticle = {
        title: headingMatch[1],
        url: headingMatch[2],
        date: '',
        description: '',
      };
      continue;
    }

    const dateMatch = line.match(/\d{2}\/\d{2}\/\d{4}\s*-\s*\d{2}:\d{2}/);
    if (dateMatch && currentArticle) {
      currentArticle.date = line;
      continue;
    }

    if (currentArticle && line && !line.startsWith('#') && !line.startsWith('![')) {
      if (!currentArticle.description) {
        currentArticle.description = line;
      } else {
        currentArticle.description += ' ' + line;
      }
    }
  }

  if (currentArticle) articles.push(currentArticle);

  let filtered = articles;
  if (search && search.trim()) {
    const q = search.trim().toLowerCase();
    filtered = articles.filter(
      (a) =>
        (a.title && a.title.toLowerCase().includes(q)) ||
        (a.description && a.description.toLowerCase().includes(q))
    );
  }

  return filtered.slice(0, limit);
}

// URL tin bài CafeF: dạng ...-188260214103735065.chn hoặc .cafef, hoặc path có id
const ARTICLE_URL_STRICT = /cafef\.vn\/[^"?#]+-\d{12,}\.(chn|cafef)/i;
const ARTICLE_URL_RELAXED = /cafef\.vn\/[^"?#\s]+/i; // bất kỳ path cafef.vn (fallback khi strict không match)

function parseCafefHTML(html, limit, search) {
  const articles = [];
  if (!html || typeof html !== 'string') return articles;

  const titleRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]+)<\/a>/gi;
  const dateRegex = /(\d{2}\/\d{2}\/\d{4}\s*-\s*\d{2}:\d{2})|(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})|(\d{1,2}\/\d{1,2}\/\d{4})/g;

  const seen = new Set();
  const titles = [];
  let match;
  while ((match = titleRegex.exec(html)) !== null && titles.length < limit * 5) {
    const rawUrl = (match[1] || '').trim();
    const url = rawUrl.startsWith('http') ? rawUrl : `https://cafef.vn${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`;
    const title = (match[2] || '')
      .replace(/&gt;/g, '>')
      .replace(/&lt;/g, '<')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .trim();
    if (!title || title.length < 12 || seen.has(url)) continue;
    // Bỏ link menu, trang chủ, tag
    if (/^(trang chủ|home|xem thêm|#|\d+\.?$)/i.test(title)) continue;
    const isStrict = ARTICLE_URL_STRICT.test(url);
    const isRelaxed = ARTICLE_URL_RELAXED.test(url) && url.length > 25 && !url.includes('/tag/');
    if (isStrict || isRelaxed) {
      seen.add(url);
      titles.push({ url, title, strict: isStrict });
    }
  }

  // Ưu tiên link match strict, rồi mới tới relaxed
  titles.sort((a, b) => (b.strict ? 1 : 0) - (a.strict ? 1 : 0));
  const unique = [];
  const seenUrl = new Set();
  for (const t of titles) {
    if (seenUrl.has(t.url)) continue;
    seenUrl.add(t.url);
    unique.push({ url: t.url, title: t.title });
  }

  const dates = [];
  while ((match = dateRegex.exec(html)) !== null && dates.length < limit * 5) {
    dates.push(match[1] || match[2] || match[3] || 'N/A');
  }

  const q = search ? search.trim().toLowerCase() : '';
  for (let i = 0; i < Math.min(unique.length, limit); i++) {
    const item = {
      title: unique[i].title,
      url: unique[i].url,
      date: dates[i] || dates[0] || new Date().toLocaleDateString('vi-VN'),
      description: '',
    };
    if (!q || item.title.toLowerCase().includes(q)) {
      articles.push(item);
    }
  }

  return articles;
}
