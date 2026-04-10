/**
 * Lấy giá và khối lượng thị trường từ VPBS – dùng cho entry/close position.
 * Cả giá và khối lượng đều lấy từ thị trường, không nhập tùy ý.
 */
const VPBANK_BASE_URL = 'https://neopro.vpbanks.com.vn/neo-inv-tools/noauth/public/v1/stock';

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
  'Referer': 'https://neopro.vpbanks.com.vn/',
  'Origin': 'https://neopro.vpbanks.com.vn'
};

function toNum(val) {
  if (val == null || val === '') return null;
  const n = typeof val === 'number' ? val : parseFloat(val);
  return Number.isFinite(n) ? n : null;
}

async function safeFetchJson(url) {
  const response = await fetch(url, { headers: FETCH_HEADERS });
  const text = await response.text();
  const trimmed = text.trim();
  if (trimmed.startsWith('<')) {
    throw new Error(`VPBS returned HTML (status ${response.status}) — service may be down or blocking this IP`);
  }
  return JSON.parse(trimmed);
}

/** Lô chuẩn sàn VN: 100 cp. Khối lượng từ thị trường làm tròn về bội số 100. */
const LOT_SIZE = 100;

/**
 * Lấy giá thị trường hiện tại cho symbol từ VPBS.
 */
export async function getMarketPrice(symbol) {
  const data = await getMarketData(symbol);
  return {
    price: data.price,
    lastPrice: data.price,
    reference: data.reference,
    high: data.high,
    low: data.low,
    error: data.error
  };
}

/**
 * Lấy cả giá và khối lượng thị trường (order book / advancedInfo).
 * Khối lượng = khối lượng bán tại mức giá tốt (hoặc totalTrading từ advancedInfo), làm tròn theo lô 100.
 * @returns {Promise<{ price: number|null, quantity: number|null, reference, high, low, error?: string }>}
 */
export async function getMarketData(symbol) {
  try {
    const [adv, ob] = await Promise.all([
      safeFetchJson(`${VPBANK_BASE_URL}/stockAdvancedInfo?symbols=${encodeURIComponent(symbol)}`),
      safeFetchJson(`${VPBANK_BASE_URL}/matchingHistoryBuyUpSellDown?symbol=${encodeURIComponent(symbol)}`)
    ]);

    let price = null;
    let reference = null;
    let high = null;
    let low = null;
    let quantity = null;

    if (adv.status === 1 && adv.data?.[0]) {
      const d = adv.data[0];
      price = toNum(d.closePrice) ?? toNum(d.matchPrice) ?? toNum(d.lastPrice);
      reference = toNum(d.reference);
      high = toNum(d.high) ?? price;
      low = toNum(d.low) ?? price;
      const vol = toNum(d.totalTrading) ?? toNum(d.totalVolume) ?? toNum(d.volume);
      if (vol != null && vol > 0) quantity = Math.max(LOT_SIZE, Math.floor(vol / LOT_SIZE) * LOT_SIZE);
    }

    const inner = ob?.data?.data ?? ob?.data ?? ob;
    const priceStatistic = inner?.priceStatistic ?? inner?.priceLevels ?? [];
    if (Array.isArray(priceStatistic) && priceStatistic.length > 0 && quantity == null) {
      const sellVol = priceStatistic
        .map((l) => toNum(l.sellVolume) ?? toNum(l.sellDownVolume) ?? toNum(l.volume))
        .filter((v) => v != null && v > 0);
      if (sellVol.length) {
        const sum = sellVol.reduce((a, b) => a + b, 0);
        quantity = Math.max(LOT_SIZE, Math.floor(sum / LOT_SIZE) * LOT_SIZE);
      }
    }

    if (quantity == null) quantity = LOT_SIZE;

    return {
      price: price ?? reference,
      reference,
      high,
      low,
      quantity,
      error: price == null && reference == null ? 'No market data from VPBS' : undefined
    };
  } catch (err) {
    console.error('marketPriceService.getMarketData:', err.message);
    return {
      price: null,
      reference: null,
      high: null,
      low: null,
      quantity: null,
      error: err.message
    };
  }
}

export default { getMarketPrice, getMarketData };
