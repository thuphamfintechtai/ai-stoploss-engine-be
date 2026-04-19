/**
 * promptContextEnricher.js — AIT-06 (D-06)
 *
 * Grounding Gemini prompt bằng bối cảnh thực tế VN:
 *   - VN-Index trend 1 ngày (% change close vs reference)
 *   - Sector của mã (phân loại nội bộ)
 *   - Tối đa 3 tin cafef gần nhất cho mã
 *
 * Hợp đồng graceful degrade: bất kỳ source nào fail → result vẫn có đủ field,
 * `header` luôn build được để caller concat vào prompt. KHÔNG throw.
 *
 * Cache per-symbol 5 phút (TTL) để tránh spam VPBS + scraping cafef.
 * Header length capped ≤ 2000 ký tự (tránh blow up token budget Gemini).
 *
 * Dùng bởi: services/aiService.js trong 4 symbol-specific functions
 *   suggestStopLossTakeProfit / analyzeTrend / generateSignal / reviewOpenPositions.
 *
 * Threats mitigated:
 *   - T-04-12 (DoS do upstream cafef/VPBS timeout): Promise.allSettled + cache 5 phút.
 *   - AIT-06 hallucinate: thêm macro context cho Gemini trước khi inference.
 */
import { getMarketData } from '../shared/marketPriceService.js';
import { getSector, SECTOR_LABELS } from './sectorClassification.js';
import { getCafefMarketNews } from '../cafefNewsService.js';

const CACHE_TTL_MS = 5 * 60_000;       // 5 phút
const CLEANUP_EVERY_MS = 10 * 60_000;  // 10 phút
const MAX_HEADER_LEN = 2000;
const MAX_NEWS_TITLE_LEN = 120;

/** Module-level per-symbol cache. key = 'SYMBOL:EXCHANGE'. */
const contextCache = new Map();

function cleanupCache() {
  const now = Date.now();
  for (const [k, v] of contextCache.entries()) {
    if (now - v.fetchedAt > CLEANUP_EVERY_MS) contextCache.delete(k);
  }
}
const CLEANUP_HANDLE = setInterval(cleanupCache, CLEANUP_EVERY_MS);
CLEANUP_HANDLE.unref?.();

/**
 * Fetch VN-Index 1 ngày + tính % change.
 * Graceful degrade: reject / thiếu data → status 'unavailable'.
 */
async function fetchVnIndex() {
  try {
    const data = await getMarketData('VNINDEX');
    if (!data || data.price == null || data.reference == null || data.reference === 0) {
      return { status: 'unavailable', change_pct: null, text: 'VN-Index: không khả dụng' };
    }
    const pct = ((data.price - data.reference) / data.reference) * 100;
    const rounded = Number(pct.toFixed(2));
    const sign = rounded >= 0 ? '+' : '';
    return {
      status: 'ok',
      change_pct: rounded,
      text: `VN-Index: ${sign}${rounded.toFixed(2)}% (${Number(data.price).toFixed(2)} điểm)`,
    };
  } catch {
    return { status: 'unavailable', change_pct: null, text: 'VN-Index: không khả dụng' };
  }
}

/**
 * Resolve sector (sync). sectorClassification.getSector trả 'OTHER' khi không phân loại
 * → map về status 'unknown' để prompt ghi "chưa phân loại".
 */
function resolveSector(symbol) {
  try {
    const key = getSector(symbol);
    if (!key || key === 'OTHER') {
      return { status: 'unknown', key: null, label: null, text: 'Ngành: chưa phân loại' };
    }
    const label = SECTOR_LABELS?.[key] || key;
    return { status: 'ok', key, label, text: `Ngành: ${label}` };
  } catch {
    return { status: 'unknown', key: null, label: null, text: 'Ngành: chưa phân loại' };
  }
}

/**
 * Fetch cafef news cho symbol, format headlines.
 * Graceful degrade: reject → 'error'. Empty articles → 'empty'.
 */
async function fetchNews(symbol) {
  try {
    const result = await getCafefMarketNews({ search: symbol, limit: 3 });
    const articles = (result?.articles || []).slice(0, 3);
    if (articles.length === 0) {
      return {
        status: 'empty',
        articles: [],
        text: `Tin tức: không có tin gần đây cho ${symbol}`,
      };
    }
    const lines = articles.map(
      (a) => `- ${String(a.title || '').slice(0, MAX_NEWS_TITLE_LEN)}`
    );
    return {
      status: 'ok',
      articles,
      text: `Tin cafef gần đây cho ${symbol}:\n${lines.join('\n')}`,
    };
  } catch {
    return { status: 'error', articles: [], text: 'Tin tức: lỗi lấy tin' };
  }
}

function buildHeader({ vnindex, sector, news }) {
  let header = `Bối cảnh thị trường:\n- ${vnindex.text}\n- ${sector.text}\n${news.text}\n`;
  if (header.length > MAX_HEADER_LEN) {
    header = header.slice(0, MAX_HEADER_LEN);
  }
  return header;
}

/**
 * Enrich symbol context cho Gemini prompt.
 * Parallel fetch 3 source với Promise.allSettled — không short-circuit.
 *
 * @param {string} symbol - Mã CK (VCB, VNM, ...)
 * @param {string} [exchange='HOSE'] - Sàn (HOSE/HNX/UPCOM)
 * @returns {Promise<{
 *   vnindex: { status: string, change_pct: number|null, text: string },
 *   sector: { status: string, key: string|null, label: string|null, text: string },
 *   news: { status: string, articles: Array, text: string },
 *   header: string
 * }>}
 */
export async function enrichSymbolContext(symbol, exchange = 'HOSE') {
  const normalizedSymbol = String(symbol || '').toUpperCase();
  const normalizedExchange = String(exchange || 'HOSE').toUpperCase();
  const key = `${normalizedSymbol}:${normalizedExchange}`;

  // Cache hit check
  const cached = contextCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.result;
  }

  // graceful degrade: Promise.allSettled bao phủ cả throws ngoài try/catch nội bộ
  const [vnRes, newsRes] = await Promise.allSettled([
    fetchVnIndex(),
    fetchNews(normalizedSymbol),
  ]);

  const vnindex =
    vnRes.status === 'fulfilled'
      ? vnRes.value
      : { status: 'unavailable', change_pct: null, text: 'VN-Index: không khả dụng' };
  const news =
    newsRes.status === 'fulfilled'
      ? newsRes.value
      : { status: 'error', articles: [], text: 'Tin tức: lỗi lấy tin' };

  const sector = resolveSector(normalizedSymbol);

  const header = buildHeader({ vnindex, sector, news });
  const result = { vnindex, sector, news, header };

  contextCache.set(key, { result, fetchedAt: Date.now() });
  return result;
}

/**
 * Helper: trả header string từ enriched result (cho caller dùng riêng khi muốn
 * compose prompt thủ công). Null-safe.
 */
export function buildContextHeader(enrichedResult) {
  return enrichedResult?.header || '';
}

/** Exported cho test: clear cache giữa các test cases. */
export const __contextCache = contextCache;
