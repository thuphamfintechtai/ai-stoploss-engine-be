import { query } from '../config/database.js';
import Joi from 'joi';
import { getCafefMarketNews as fetchCafefNews } from '../services/cafefNewsService.js';
import { getMarketData } from '../services/marketPriceService.js';

// VPBank API base URLs (dùng trong getOHLCV và các proxy)
const VPBANK_BASE_URL = 'https://neopro.vpbanks.com.vn/neo-inv-tools/noauth/public/v1/stock';
const VPBANK_MARKET_BASE_URL = 'https://neopro.vpbanks.com.vn/neo-inv-tools/noauth/public/v1/market';

// Schema chứa bảng market (ohlcv_1d, ohlcv_1m, symbols, valuation, technical_indicators).
// Nếu bảng đã có sẵn ở schema khác (vd: public) thì set DB_MARKET_SCHEMA=public trong .env
const MARKET_SCHEMA = process.env.DB_MARKET_SCHEMA || process.env.DB_SCHEMA || 'financial';

/** Chuẩn hóa số từ API: không trả NaN, trả null nếu không hợp lệ (để FE hiển thị "--" hoặc 0). */
function toNum(val) {
  if (val == null || val === '') return null;
  const n = typeof val === 'number' ? val : parseFloat(val);
  return Number.isFinite(n) ? n : null;
}

/** Headers gửi kèm khi gọi API VPBank/Neopro để giảm 403 (server chặn request không có User-Agent/Referer). */
const VPBANK_FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
  'Referer': 'https://neopro.vpbanks.com.vn/',
  'Origin': 'https://neopro.vpbanks.com.vn'
};

/**
 * Fetch URL and parse as JSON. If the API returns HTML (e.g. error/maintenance page), throws a clear error
 * instead of "Unexpected token '<'" so we can return a proper API error to the client.
 * @param {string} url
 * @returns {Promise<{ response: Response, data: any }>}
 */
/** Shorthand: fetch với VPBANK_FETCH_HEADERS, trả về Response (giống fetch). */
const vpbankFetch = (url) => fetch(url, { headers: VPBANK_FETCH_HEADERS });

async function fetchJson(url) {
  const response = await vpbankFetch(url);
  const text = await response.text();
  const trimmed = text.trim();
  if (trimmed.startsWith('<')) {
    const err = new Error(`External API returned HTML instead of JSON (status ${response.status}). The service may be down or the endpoint may have changed.`);
    err.status = response.status;
    err.url = url;
    throw err;
  }
  let data;
  try {
    data = JSON.parse(trimmed);
  } catch (e) {
    const err = new Error(`External API response is not valid JSON (status ${response.status}).`);
    err.status = response.status;
    err.url = url;
    throw err;
  }
  return { response, data };
}

// Validation schemas
export const ohlcvQuerySchema = Joi.object({
  timeframe: Joi.string().valid('1m', '1h', '1d', '1w', '1M').default('1d'),
  limit: Joi.number().min(1).max(1000).default(100)
});

/**
 * GET /market/position-form-spec
 * Spec form mở lệnh cho FE: không có ô nhập giá/khối lượng, chỉ hiển thị từ thị trường.
 */
export const getPositionFormSpec = (req, res) => {
  res.json({
    success: true,
    data: {
      description: 'Form mở lệnh: giá và khối lượng lấy từ thị trường (VPBS), không nhập tay.',
      steps: [
        '1. User chọn mã CK (symbol) – dropdown/search từ GET /api/market/stocks hoặc /api/market/symbols',
        '2. Gọi GET /api/market/symbols/:symbol/entry-info → nhận exchange, market_price, market_quantity (chỉ hiển thị, không input)',
        '3. Hiển thị: Sàn (exchange), Giá (market_price), Khối lượng (market_quantity), Tổng = market_price × market_quantity – tất cả read-only',
        '4. User chỉ nhập: loại dừng lỗ (stop_type), tham số (stop_params / stop_price), take profit nếu có',
        '5. POST /api/portfolios/:portfolioId/positions với body: { symbol, exchange, stop_type, stop_params?, stop_price? } – không gửi entry_price, không gửi quantity'
      ],
      bodyExample: {
        symbol: 'ACB',
        exchange: 'HOSE',
        stop_type: 'PERCENT',
        stop_params: { percent: 2 }
      },
      fieldsFromMarket: ['exchange', 'market_price', 'market_quantity'],
      fieldsNoInput: ['entry_price', 'quantity'],
      entryInfoUrl: 'GET /api/market/symbols/:symbol/entry-info',
      createUrl: 'POST /api/portfolios/:portfolioId/positions'
    }
  });
};

// Get all symbols
export const getSymbols = async (req, res, next) => {
  try {
    const { exchange, type, is_enabled } = req.query;

    let queryText = `
      SELECT symbol, exchange
      FROM ${MARKET_SCHEMA}.symbols
      WHERE 1=1
    `;

    const params = [];
    let paramIndex = 1;

    if (exchange) {
      queryText += ` AND exchange = $${paramIndex++}`;
      params.push(exchange);
    }

    if (type) {
      queryText += ` AND symbol_type = $${paramIndex++}`;
      params.push(type);
    }

    if (is_enabled !== undefined) {
      queryText += ` AND is_enabled = $${paramIndex++}`;
      params.push(is_enabled === 'true');
    }

    queryText += ` ORDER BY symbol ASC`;

    const result = await query(queryText, params);

    res.json({
      success: true,
      data: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    if (error.code === '42P01') {
      return res.json({ success: true, data: [], count: 0, note: 'Bảng symbols chưa có.' });
    }
    next(error);
  }
};

/** GET /market/symbols/:symbol/info — Lấy symbol + exchange từ DB (mã CK → tên sàn). */
export const getSymbolInfo = async (req, res, next) => {
  try {
    const raw = (req.params.symbol || '').toString().trim();
    if (!raw) {
      return res.status(400).json({ success: false, message: 'Symbol is required' });
    }
    const result = await query(
      `SELECT symbol, exchange
       FROM ${MARKET_SCHEMA}.symbols
       WHERE UPPER(TRIM(symbol)) = UPPER($1)
         AND (is_enabled IS NULL OR is_enabled = true)
       LIMIT 1`,
      [raw]
    );
    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        message: `Không tìm thấy mã ${raw} trong danh sách.`,
        data: null
      });
    }
    const row = result.rows[0];
    res.json({
      success: true,
      data: { symbol: row.symbol, exchange: row.exchange }
    });
  } catch (error) {
    if (error.code === '42P01') {
      return res.status(404).json({ success: false, message: 'Bảng symbols chưa có.', data: null });
    }
    next(error);
  }
};

// Get current price for a symbol – nguồn VPBS (VPBank) API
export const getPrice = async (req, res, next) => {
  try {
    const { symbol } = req.params;

    const { data: json } = await fetchJson(`${VPBANK_BASE_URL}/stockAdvancedInfo?symbols=${symbol}`);

    if (json.status !== 1 || !json.data?.[0]) {
      return res.status(404).json({
        success: false,
        message: `No price data found for ${symbol} (VPBS)`
      });
    }

    const d = json.data[0];
    const closePrice = toNum(d.closePrice);
    const openPrice = toNum(d.reference) ?? closePrice;
    const high = toNum(d.high) ?? closePrice;
    const low = toNum(d.low) ?? closePrice;
    const volume = toNum(d.totalTrading) ?? toNum(d.totalVolume) ?? toNum(d.volume);

    res.json({
      success: true,
      data: {
        symbol: d.symbol || symbol,
        exchange: d.exchange || 'HOSE',
        price: closePrice,
        open: openPrice,
        high,
        low,
        volume,
        change: toNum(d.change),
        percentChange: toNum(d.stockPercentChange) ?? toNum(d.percentChange),
        source: 'VPBS'
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /market/symbols/:symbol/entry-info?quantity=10000
 * Chọn symbol → trả exchange + giá + khối lượng thị trường (không nhập giá/kl);
 * quantity query → trả thêm total_value. Giá và khối lượng đều từ VPBS.
 */
// Giá VPBS trả theo nghìn đồng = điểm (1 điểm = 1.000). API trả về điểm cho hiển thị; DB vẫn lưu VND.
const POINT_TO_VND = 1000;
export const getEntryInfo = async (req, res, next) => {
  try {
    const raw = (req.params.symbol || '').toString().trim();
    if (!raw) {
      return res.status(400).json({ success: false, message: 'Symbol is required' });
    }
    const quantityQuery = req.query.quantity != null ? parseFloat(req.query.quantity) : null;

    let exchangeFromDb = null;
    try {
      const dbResult = await query(
        `SELECT exchange FROM ${MARKET_SCHEMA}.symbols
         WHERE UPPER(TRIM(symbol)) = UPPER($1) AND (is_enabled IS NULL OR is_enabled = true) LIMIT 1`,
        [raw]
      );
      if (dbResult.rows.length) exchangeFromDb = (dbResult.rows[0].exchange || '').toString().toUpperCase();
    } catch (_) { /* ignore */ }

    const marketData = await getMarketData(raw);
    const market_price_point = marketData.price != null && marketData.price > 0 ? marketData.price : null;
    const exchange = (exchangeFromDb || 'HOSE').toString().toUpperCase();

    const data = {
      symbol: raw.toString().toUpperCase(),
      exchange,
      market_price: market_price_point,
      market_quantity: marketData.quantity ?? null,
      source: 'VPBS'
    };

    const quantity = quantityQuery ?? marketData.quantity;
    if (quantity != null && Number.isFinite(quantity) && quantity > 0 && market_price_point != null) {
      data.quantity = quantity;
      data.total_value = Math.round(market_price_point * POINT_TO_VND * quantity);
    }

    res.json({
      success: true,
      data,
      hint: 'Hiển thị exchange + market_price + market_quantity khi chọn symbol; cả giá và khối lượng lấy từ thị trường.'
    });
  } catch (error) {
    next(error);
  }
};

// Get OHLCV data from VPBank TradingView API
export const getOHLCV = async (req, res, next) => {
  try {
    const { symbol } = req.params;
    const { timeframe = '1d', limit = 100 } = req.query;
    const maxLimit = Math.min(parseInt(limit), 1000);

    // Map timeframe to VPBank resolution
    let resolution;
    if (timeframe === '1m') resolution = '1M';
    else if (timeframe === '1h') resolution = '1H';
    else if (timeframe === '1d') resolution = '1D';
    else if (timeframe === '1w') resolution = '1D'; // Will aggregate
    else if (timeframe === '1M') resolution = '1D'; // Will aggregate
    else {
      return res.status(400).json({
        success: false,
        message: `Invalid timeframe. Supported: 1m, 1h, 1d, 1w, 1M`
      });
    }

    // Calculate time range (from now back to limit periods)
    const now = Math.floor(Date.now() / 1000);
    let fromTime;
    if (timeframe === '1m') fromTime = now - (maxLimit * 60); // minutes
    else if (timeframe === '1h') fromTime = now - (maxLimit * 3600); // hours
    else if (timeframe === '1d') fromTime = now - (maxLimit * 86400); // days
    else if (timeframe === '1w') fromTime = now - (maxLimit * 7 * 86400); // weeks
    else if (timeframe === '1M') fromTime = now - (maxLimit * 30 * 86400); // months (approx)

    // Fetch from VPBank API
    const url = `${VPBANK_BASE_URL}/tradingViewChart?symbol=${symbol}&resolution=${resolution}&from=${fromTime}&to=${now}`;
    const { data: vpbankData } = await fetchJson(url);

    if (vpbankData.status !== 1 || !vpbankData.data) {
      return res.status(404).json({
        success: false,
        message: 'No data found from VPBank'
      });
    }

    const { t, o, h, l, c, v } = vpbankData.data;

    // Convert arrays to OHLCV objects
    let candles = t.map((time, i) => ({
      timestamp: new Date(time * 1000).toISOString(),
      open: parseFloat(o[i]),
      high: parseFloat(h[i]),
      low: parseFloat(l[i]),
      close: parseFloat(c[i]),
      volume: parseFloat(v[i])
    }));

    // Aggregate for weekly/monthly if needed
    if (timeframe === '1w') {
      candles = aggregateToWeekly(candles);
    } else if (timeframe === '1M') {
      candles = aggregateToMonthly(candles);
    }

    // Limit to requested count
    candles = candles.slice(-maxLimit);

    res.json({
      success: true,
      data: candles,
      count: candles.length,
      symbol,
      timeframe,
      source: 'VPBank'
    });
  } catch (error) {
    if (error.status != null) {
      console.warn('VPBank TradingView API upstream unavailable (status %s)', error.status);
      return res.status(503).json({
        success: false,
        message: 'Market data temporarily unavailable. The data provider may be down or restricting access.',
        code: 'UPSTREAM_UNAVAILABLE'
      });
    }
    console.error('VPBank TradingView API error:', error);
    next(error);
  }
};

// Helper: Aggregate daily candles to weekly
function aggregateToWeekly(dailyCandles) {
  const weeklyMap = new Map();

  dailyCandles.forEach(candle => {
    const date = new Date(candle.timestamp);
    // Get Monday of the week
    const dayOfWeek = date.getDay();
    const diff = date.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
    const monday = new Date(date.setDate(diff));
    monday.setHours(0, 0, 0, 0);
    const weekKey = monday.toISOString();

    if (!weeklyMap.has(weekKey)) {
      weeklyMap.set(weekKey, {
        timestamp: weekKey,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
        candles: []
      });
    }

    const week = weeklyMap.get(weekKey);
    week.high = Math.max(week.high, candle.high);
    week.low = Math.min(week.low, candle.low);
    week.close = candle.close; // Last close
    week.volume += candle.volume;
    week.candles.push(candle);
  });

  return Array.from(weeklyMap.values());
}

// Helper: Aggregate daily candles to monthly
function aggregateToMonthly(dailyCandles) {
  const monthlyMap = new Map();

  dailyCandles.forEach(candle => {
    const date = new Date(candle.timestamp);
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

    if (!monthlyMap.has(monthKey)) {
      monthlyMap.set(monthKey, {
        timestamp: new Date(date.getFullYear(), date.getMonth(), 1).toISOString(),
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
        candles: []
      });
    }

    const month = monthlyMap.get(monthKey);
    month.high = Math.max(month.high, candle.high);
    month.low = Math.min(month.low, candle.low);
    month.close = candle.close; // Last close
    month.volume += candle.volume;
    month.candles.push(candle);
  });

  return Array.from(monthlyMap.values());
}

// Technical indicators – VPBS không cung cấp; chỉ trả từ DB nếu có bảng (tùy chọn)
export const getIndicators = async (req, res, next) => {
  try {
    const { symbol } = req.params;
    const { timeframe = '1d', exchange = 'HOSE' } = req.query;

    const result = await query(
      `SELECT symbol, exchange, timeframe, indicators, moving_averages,
              oscillators, summary, last_updated
       FROM ${MARKET_SCHEMA}.technical_indicators
       WHERE symbol = $1 AND exchange = $2 AND timeframe = $3
       ORDER BY last_updated DESC
       LIMIT 1`,
      [symbol, exchange, timeframe]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: `No technical indicators for ${symbol} (VPBS không cung cấp; có thể lưu từ nguồn khác vào DB).`
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    if (error.code === '42P01') {
      return res.status(404).json({
        success: false,
        message: 'Technical indicators not available (bảng technical_indicators chưa có hoặc không dùng).'
      });
    }
    next(error);
  }
};

// Get market overview – dữ liệu từ VPBS; nếu cần gainers/losers theo từng mã thì gọi getPrice/getSymbolDetail
export const getOverview = async (req, res, next) => {
  try {
    const { exchange = 'HOSE', limit = 10 } = req.query;
    const lim = Math.min(parseInt(limit) || 10, 50);

    const { data: indicesData } = await fetchJson(
      `${VPBANK_MARKET_BASE_URL}/intradayMarketIndex?indexCode=VN30`
    );
    const indexData = indicesData?.data ?? indicesData;

    res.json({
      success: true,
      data: {
        exchange,
        index_summary: indexData ? { indexCode: 'VN30', data: indexData } : null,
        top_gainers: [],
        top_losers: [],
        most_active: [],
        note: 'Gainers/losers lấy theo từng mã qua GET /api/market/symbols/:symbol/price hoặc stockAdvancedInfo (VPBS).'
      },
      source: 'VPBS'
    });
  } catch (error) {
    next(error);
  }
};

// Get all stocks – danh sách symbol từ DB; giá lấy từ VPBS qua getPrice(symbol) hoặc getSymbolDetail
export const getStocks = async (req, res, next) => {
  try {
    const { exchange, search, sort = 'symbol', order = 'ASC', page = 1, limit = 50 } = req.query;
    const limitNum = Math.min(Math.max(1, parseInt(limit) || 50), 100);
    const offset = (Math.max(1, parseInt(page) || 1) - 1) * limitNum;
    const sortOrder = order.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    const validSortFields = ['symbol', 'exchange'];
    const sortField = validSortFields.includes(sort) ? sort : 'symbol';

    let whereClause = 'WHERE 1=1';
    const params = [];
    let paramIndex = 1;

    // Chỉ lấy symbol đang hoạt động và type = STOCK (cổ phiếu)
    whereClause += ` AND (is_enabled IS NULL OR is_enabled = true)`;
    whereClause += ` AND type = $${paramIndex++}`;
    params.push('STOCK');
    // Ẩn mã A32 khỏi danh sách
    whereClause += ` AND UPPER(TRIM(symbol)) <> 'A32'`;

    if (exchange) {
      whereClause += ` AND exchange = $${paramIndex++}`;
      params.push(exchange);
    }
    if (search) {
      whereClause += ` AND symbol ILIKE $${paramIndex++}`;
      params.push(`%${search}%`);
    }

    const dataQuery = `
      SELECT symbol, exchange
      FROM ${MARKET_SCHEMA}.symbols
      ${whereClause}
      ORDER BY ${sortField} ${sortOrder}
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;
    const countQuery = `
      SELECT COUNT(*) as total FROM ${MARKET_SCHEMA}.symbols ${whereClause}
    `;

    const [dataResult, countResult] = await Promise.all([
      query(dataQuery, [...params, limitNum, offset]),
      query(countQuery, params)
    ]);

    const total = parseInt(countResult.rows[0]?.total ?? 0, 10);
    const totalPages = Math.ceil(total / limitNum);

    // Enrich với giá & khối lượng từ VPBS (batch: symbols=SYM1,SYM2,...; nếu ít hơn số dòng thì gọi từng mã)
    const rows = dataResult.rows;
    if (rows.length > 0) {
      const bySymbol = {};
      const symbolsParam = rows.map((r) => r.symbol).join(',');
      try {
        const { data: vpJson } = await fetchJson(`${VPBANK_BASE_URL}/stockAdvancedInfo?symbols=${encodeURIComponent(symbolsParam)}`);
        if (vpJson.status === 1 && Array.isArray(vpJson.data) && vpJson.data.length > 0) {
          for (const d of vpJson.data) {
            const sym = (d.symbol ?? d.code ?? '').toString().trim();
            if (!sym) continue;
            const price = toNum(d.closePrice) ?? toNum(d.lastPrice) ?? toNum(d.currentPrice) ?? toNum(d.price);
            const vol = toNum(d.totalTrading) ?? toNum(d.totalVolume) ?? toNum(d.volume) ?? toNum(d.totalTradingVolume) ?? toNum(d.matchVolume);
            bySymbol[sym] = { price, volume: vol };
          }
        }
      } catch (e) {
        // bỏ qua
      }
      // Gọi lại từng mã khi: batch không trả, hoặc cả giá & kl đều 0/thiếu (VPBS đôi khi trả 0 trong batch nhưng trả đủ khi gọi 1 mã)
      const key = (s) => (s ?? '').toString().trim();
      const hasValidData = (info) => info && ((Number(info.price) > 0) || (Number(info.volume) > 0));
      const missing = rows.filter((r) => !hasValidData(bySymbol[key(r.symbol)]));
      const CONCURRENCY = 5;
      for (let i = 0; i < missing.length; i += CONCURRENCY) {
        const chunk = missing.slice(i, i + CONCURRENCY);
        const results = await Promise.all(
          chunk.map(async (row) => {
            try {
              const { data: json } = await fetchJson(`${VPBANK_BASE_URL}/stockAdvancedInfo?symbols=${encodeURIComponent(row.symbol)}`);
              if (json.status === 1 && json.data?.[0]) {
                const d = json.data[0];
                const price = toNum(d.closePrice) ?? toNum(d.lastPrice) ?? toNum(d.currentPrice) ?? toNum(d.price);
                const vol = toNum(d.totalTrading) ?? toNum(d.totalVolume) ?? toNum(d.volume) ?? toNum(d.totalTradingVolume) ?? toNum(d.matchVolume);
                return {
                  symbol: row.symbol,
                  price,
                  volume: vol
                };
              }
            } catch (err) {}
            return { symbol: row.symbol, price: null, volume: null };
          })
        );
        for (const r of results) {
          bySymbol[key(r.symbol)] = { price: r.price, volume: r.volume };
        }
      }
      for (const row of rows) {
        const info = bySymbol[key(row.symbol)];
        row.price = info?.price ?? null;
        row.volume = info?.volume ?? null;
      }
    }

    res.json({
      success: true,
      data: rows,
      pagination: {
        page: parseInt(page) || 1,
        limit: limitNum,
        total,
        totalPages,
        hasNext: parseInt(page) < totalPages,
        hasPrev: parseInt(page) > 1
      },
      note: 'Giá & KL từ VPBS (batch). Nếu thiếu: GET /api/market/symbols/:symbol/price.'
    });
  } catch (error) {
    if (error.code === '42P01') {
      return res.json({
        success: true,
        data: [],
        pagination: { page: 1, limit: 50, total: 0, totalPages: 0, hasNext: false, hasPrev: false },
        note: 'Bảng symbols chưa có. Tạo bảng hoặc dùng GET /api/market/symbols (nếu có nguồn khác).'
      });
    }
    next(error);
  }
};

// Get symbol details – nguồn VPBS (stockAdvancedInfo); symbol list từ DB
export const getSymbolDetail = async (req, res, next) => {
  try {
    const { symbol } = req.params;

    const { data: json } = await fetchJson(`${VPBANK_BASE_URL}/stockAdvancedInfo?symbols=${symbol}`);

    if (json.status !== 1 || !json.data?.[0]) {
      return res.status(404).json({
        success: false,
        message: `Symbol not found: ${symbol} (VPBS)`
      });
    }

    const advInfo = json.data[0];

    // Map tất cả key có thể từ VPBS (một số API trả referencePrice, floorPrice, ceilingPrice, totalTradingVolume, totalTradingValue)
    const reference = toNum(advInfo.reference) ?? toNum(advInfo.referencePrice) ?? toNum(advInfo.basicPrice);
    const ceiling = toNum(advInfo.ceiling) ?? toNum(advInfo.ceilingPrice);
    const floor = toNum(advInfo.floor) ?? toNum(advInfo.floorPrice);
    const totalTradingVal = toNum(advInfo.totalTrading) ?? toNum(advInfo.volume) ?? toNum(advInfo.totalVolume) ?? toNum(advInfo.totalTradingVolume);
    const totalValueVal = toNum(advInfo.totalValue) ?? toNum(advInfo.totalTradingValue) ?? toNum(advInfo.tradingValue);

    // Bid/Ask 3 cấp từ VPBS response
    const gia1 = toNum(advInfo.bidPrice1) ?? toNum(advInfo.bid1) ?? toNum(advInfo.buyPrice1) ?? toNum(advInfo.gia1);
    const gia2 = toNum(advInfo.bidPrice2) ?? toNum(advInfo.bid2) ?? toNum(advInfo.buyPrice2) ?? toNum(advInfo.gia2);
    const gia3 = toNum(advInfo.bidPrice3) ?? toNum(advInfo.bid3) ?? toNum(advInfo.buyPrice3) ?? toNum(advInfo.gia3);
    const kl1  = toNum(advInfo.bidVolume1) ?? toNum(advInfo.bidVol1) ?? toNum(advInfo.buyVolume1) ?? toNum(advInfo.kl1);
    const kl2  = toNum(advInfo.bidVolume2) ?? toNum(advInfo.bidVol2) ?? toNum(advInfo.buyVolume2) ?? toNum(advInfo.kl2);
    const kl3  = toNum(advInfo.bidVolume3) ?? toNum(advInfo.bidVol3) ?? toNum(advInfo.buyVolume3) ?? toNum(advInfo.kl3);
    const askPrice1 = toNum(advInfo.askPrice1) ?? toNum(advInfo.ask1) ?? toNum(advInfo.sellPrice1);
    const askPrice2 = toNum(advInfo.askPrice2) ?? toNum(advInfo.ask2) ?? toNum(advInfo.sellPrice2);
    const askPrice3 = toNum(advInfo.askPrice3) ?? toNum(advInfo.ask3) ?? toNum(advInfo.sellPrice3);
    const askVol1   = toNum(advInfo.askVolume1) ?? toNum(advInfo.askVol1) ?? toNum(advInfo.sellVolume1);
    const askVol2   = toNum(advInfo.askVolume2) ?? toNum(advInfo.askVol2) ?? toNum(advInfo.sellVolume2);
    const askVol3   = toNum(advInfo.askVolume3) ?? toNum(advInfo.askVol3) ?? toNum(advInfo.sellVolume3);

    const data = {
      symbol: advInfo.symbol || symbol,
      exchange: advInfo.exchange || 'HOSE',
      companyName: advInfo.organName ?? advInfo.companyName ?? null,
      industry: advInfo.icbCodeLv1 || null,
      marketCap: toNum(advInfo.marketCap),
      totalTrading: totalTradingVal,
      totalValue: totalValueVal,
      closePrice: toNum(advInfo.closePrice),
      openPrice: toNum(advInfo.openPrice) ?? toNum(advInfo.open),
      highestPrice: toNum(advInfo.highestPrice) ?? toNum(advInfo.high),
      lowestPrice: toNum(advInfo.lowestPrice) ?? toNum(advInfo.low),
      change: toNum(advInfo.change),
      percentChange: toNum(advInfo.stockPercentChange) ?? toNum(advInfo.percentChange),
      reference,
      ceiling,
      floor,
      // Bid/Ask 3 cấp (null nếu VPBS không trả về)
      gia1, kl1, gia2, kl2, gia3, kl3,
      askPrice1, askVol1, askPrice2, askVol2, askPrice3, askVol3,
      indices: advInfo.indexs || [],
      pe: toNum(advInfo.pe),
      pb: toNum(advInfo.pb),
      eps: toNum(advInfo.eps),
      roe: toNum(advInfo.roe),
      roa: toNum(advInfo.roa),
      beta: toNum(advInfo.beta),
      avgVol10s: toNum(advInfo.avgVol10s),
      foreignNetBSVal: toNum(advInfo.foreignNetBSVal),
      isForeignNetBuy: Boolean(advInfo.isForeignNetBuy),
      source: 'VPBS',
      raw: advInfo
    };

    res.json({
      success: true,
      data
    });
  } catch (error) {
    if (error.status != null) {
      return res.status(503).json({ success: false, message: 'Market data temporarily unavailable.', code: 'UPSTREAM_UNAVAILABLE' });
    }
    next(error);
  }
};

// Get company info from VPBank
export const getCompanyInfo = async (req, res, next) => {
  try {
    const { symbol } = req.params;
    const { data } = await fetchJson(`${VPBANK_BASE_URL}/stockCompanyInfo?symbol=${symbol}`);
    res.json({ success: true, data });
  } catch (error) {
    if (error.status != null) {
      return res.status(503).json({ success: false, message: 'Market data temporarily unavailable.', code: 'UPSTREAM_UNAVAILABLE' });
    }
    next(error);
  }
};

// Get shareholders from VPBank
export const getShareholders = async (req, res, next) => {
  try {
    const { symbol } = req.params;
    const { type = 'ALL' } = req.query;
    const { data } = await fetchJson(`${VPBANK_BASE_URL}/stockCompanyShareholders?symbol=${symbol}&type=${type}`);
    res.json({ success: true, data });
  } catch (error) {
    if (error.status != null) {
      return res.status(503).json({ success: false, message: 'Market data temporarily unavailable.', code: 'UPSTREAM_UNAVAILABLE' });
    }
    next(error);
  }
};

// Get advanced info from VPBank
export const getAdvancedInfo = async (req, res, next) => {
  try {
    const { symbol } = req.params;
    const { data } = await fetchJson(`${VPBANK_BASE_URL}/stockAdvancedInfo?symbols=${symbol}`);
    res.json({ success: true, data });
  } catch (error) {
    if (error.status != null) {
      return res.status(503).json({ success: false, message: 'Market data temporarily unavailable.', code: 'UPSTREAM_UNAVAILABLE' });
    }
    next(error);
  }
};

// Get intraday matching history (Khớp lệnh) – chuẩn hóa response cho FE
export const getMatchingHistory = async (req, res, next) => {
  try {
    const { symbol } = req.params;
    const { pageSize = 50 } = req.query;

    const { data: raw } = await fetchJson(`${VPBANK_BASE_URL}/intradayMatchingHistory?symbol=${symbol}&pageSize=${pageSize}`);

    const inner = raw?.data?.data ?? raw?.data ?? raw;
    const arrayList = inner?.arrayList ?? inner?.list ?? inner?.trades ?? [];

    let totalTradingVolume = toNum(inner?.totalTradingVolume) ?? toNum(inner?.totalVolume) ?? toNum(inner?.volume);
    let buyUpVolume = toNum(inner?.buyUpVolume) ?? toNum(inner?.buyVolume);
    let sellDownVolume = toNum(inner?.sellDownVolume) ?? toNum(inner?.sellVolume);

    if (arrayList.length > 0 && (totalTradingVolume == null || buyUpVolume == null || sellDownVolume == null)) {
      let tot = 0, buy = 0, sell = 0;
      arrayList.forEach((t) => {
        const v = toNum(t.tradingVolume) ?? toNum(t.volume) ?? 0;
        tot += v;
        const style = (t.style ?? t.side ?? '').toString().toUpperCase();
        if (style === 'B' || style === 'BUY' || t.buyUp) buy += v;
        else if (style === 'S' || style === 'SELL' || t.sellDown) sell += v;
      });
      if (totalTradingVolume == null) totalTradingVolume = tot;
      if (buyUpVolume == null) buyUpVolume = buy;
      if (sellDownVolume == null) sellDownVolume = sell;
    }

    res.json({
      success: true,
      data: {
        arrayList,
        totalTradingVolume: totalTradingVolume ?? 0,
        buyUpVolume: buyUpVolume ?? 0,
        sellDownVolume: sellDownVolume ?? 0
      }
    });
  } catch (error) {
    if (error.status != null) {
      return res.status(503).json({ success: false, message: 'Market data temporarily unavailable.', code: 'UPSTREAM_UNAVAILABLE' });
    }
    next(error);
  }
};

// Get order book / price levels (Bước giá) – chuẩn hóa response cho FE
export const getOrderBook = async (req, res, next) => {
  try {
    const { symbol } = req.params;

    const { data: raw } = await fetchJson(`${VPBANK_BASE_URL}/matchingHistoryBuyUpSellDown?symbol=${symbol}`);

    const inner = raw?.data?.data ?? raw?.data ?? raw;
    const priceStatistic = inner?.priceStatistic ?? inner?.data?.priceStatistic ?? inner?.priceLevels ?? [];

    res.json({
      success: true,
      data: {
        priceStatistic: Array.isArray(priceStatistic) ? priceStatistic : []
      }
    });
  } catch (error) {
    if (error.status != null) {
      return res.status(503).json({ success: false, message: 'Market data temporarily unavailable.', code: 'UPSTREAM_UNAVAILABLE' });
    }
    next(error);
  }
};

// Get intraday OHLCV from VPBank (1-minute candles)
export const getIntradayOHLCV = async (req, res, next) => {
  try {
    const { symbol } = req.params;
    const { pageSize = 500 } = req.query;

    const { data } = await fetchJson(`${VPBANK_BASE_URL}/intradayMatchingHistory?symbol=${symbol}&pageSize=${pageSize}`);

    if (data.status !== 1) {
      return res.status(404).json({
        success: false,
        message: 'No intraday data found'
      });
    }

    // Aggregate matching history into 1-minute candles
    const trades = data.data.arrayList || [];
    const candlesMap = new Map();

    trades.forEach(trade => {
      // Extract minute from time (e.g., "14:45:23" -> "14:45")
      const minute = trade.time.substring(0, 5);
      const price = parseFloat(trade.matchPrice);
      const volume = parseFloat(trade.tradingVolume);

      if (!candlesMap.has(minute)) {
        candlesMap.set(minute, {
          time: minute,
          open: price,
          high: price,
          low: price,
          close: price,
          volume: volume,
          trades: []
        });
      }

      const candle = candlesMap.get(minute);
      candle.high = Math.max(candle.high, price);
      candle.low = Math.min(candle.low, price);
      candle.close = price; // Last trade in this minute
      candle.volume += volume;
      candle.trades.push(trade);
    });

    // Convert map to sorted array (chronological order)
    const candles = Array.from(candlesMap.values())
      .sort((a, b) => a.time.localeCompare(b.time))
      .map(candle => {
        // Convert time "14:45" to today's timestamp
        const today = new Date();
        const [hours, minutes] = candle.time.split(':');
        today.setHours(parseInt(hours), parseInt(minutes), 0, 0);

        return {
          timestamp: today.toISOString(),
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
          num_trades: candle.trades.length
        };
      });

    res.json({
      success: true,
      data: candles,
      count: candles.length,
      symbol,
      exchange: 'VPBank',
      timeframe: '1m',
      source: 'intraday_matching'
    });
  } catch (error) {
    if (error.status != null) {
      return res.status(503).json({ success: false, message: 'Market data temporarily unavailable.', code: 'UPSTREAM_UNAVAILABLE' });
    }
    next(error);
  }
};

// Supported index codes for VPBS intraday market index (VN30, VN100, HNX, ...)
const INDEX_CODES = ['VNINDEX', 'VN30', 'HNX', 'HNX30', 'UPCOM', 'VNX50', 'VNSI', 'VNSML', 'VNALL', 'VNXALL', 'VNMID', 'VN100'];

// Get intraday market index from VPBank (single index)
export const getIntradayMarketIndex = async (req, res, next) => {
  try {
    const { indexCode = 'VN30' } = req.query;
    const code = String(indexCode).toUpperCase();

    const { response, data } = await fetchJson(
      `${VPBANK_MARKET_BASE_URL}/intradayMarketIndex?indexCode=${encodeURIComponent(code)}`
    );

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        message: 'VPBank market index API error',
        data: data
      });
    }

    res.json({
      success: true,
      data: data.data ?? data,
      indexCode: code,
      source: 'VPBank'
    });
  } catch (error) {
    if (error.status != null) {
      console.warn('intradayMarketIndex upstream unavailable (status %s)', error.status);
      return res.status(503).json({
        success: false,
        message: 'Market data temporarily unavailable.',
        code: 'UPSTREAM_UNAVAILABLE'
      });
    }
    console.error('VPBank API Error (intradayMarketIndex):', error);
    next(error);
  }
};

// Get multiple intraday market indices (for overview page)
export const getIntradayMarketIndices = async (req, res, next) => {
  try {
    const { codes } = req.query;
    const requestedCodes = codes
      ? String(codes).split(',').map(c => c.trim().toUpperCase()).filter(Boolean)
      : ['VN30', 'VN100', 'HNX'];

    const limit = 10;
    const toFetch = requestedCodes.slice(0, limit);

    const results = await Promise.allSettled(
      toFetch.map(async (code) => {
        const { data } = await fetchJson(
          `${VPBANK_MARKET_BASE_URL}/intradayMarketIndex?indexCode=${encodeURIComponent(code)}`
        );
        const payload = data.data ?? data;
        return { indexCode: code, data: payload, status: data.status, raw: data };
      })
    );

    const indices = results.map((r, i) => {
      if (r.status === 'fulfilled') {
        return { indexCode: toFetch[i], success: true, ...r.value };
      }
      return { indexCode: toFetch[i], success: false, error: r.reason?.message };
    });

    res.json({
      success: true,
      data: indices,
      source: 'VPBank'
    });
  } catch (error) {
    console.error('VPBank API Error (intradayMarketIndices):', error);
    next(error);
  }
};

/**
 * GET /market/market-index-detail
 * Tóm tắt chỉ số (Neopro marketIndexDetail). Query: indexCode=VNINDEX,VN30,VNXALL,HNX30,...
 * Trả về: indexCode, indexValue, indexChange, sumVolume, sumValue, advances, declines, noChange.
 */
export const getMarketIndexDetail = async (req, res, next) => {
  try {
    const indexCode = (req.query.indexCode && String(req.query.indexCode).trim()) || 'VNINDEX,VN30,VNXALL,HNX30';
    const url = `${VPBANK_MARKET_BASE_URL}/marketIndexDetail?indexCode=${encodeURIComponent(indexCode)}`;
    const { response, data: json } = await fetchJson(url);

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        message: 'Neopro marketIndexDetail API error',
        status: response.status
      });
    }

    const rawList = Array.isArray(json.data) ? json.data : [];
    const data = rawList.map((d) => ({
      indexCode: (d.indexCode ?? d.code ?? '').toString().trim(),
      marketCode: (d.marketCode ?? d.exchange ?? '').toString().trim(),
      indexValue: toNum(d.indexValue) ?? toNum(d.value) ?? toNum(d.close),
      prevIndexValue: toNum(d.prevIndexValue) ?? toNum(d.previousClose),
      indexChange: toNum(d.indexChange) ?? toNum(d.change),
      indexPercentChange: toNum(d.indexPercentChange) ?? toNum(d.percentChange),
      sumVolume: toNum(d.sumVolume) ?? toNum(d.totalVolume) ?? toNum(d.volume),
      sumValue: toNum(d.sumValue) ?? toNum(d.totalValue) ?? toNum(d.value),
      advances: toNum(d.advances) ?? toNum(d.advancing) ?? 0,
      declines: toNum(d.declines) ?? toNum(d.declining) ?? 0,
      noChange: toNum(d.noChange) ?? toNum(d.unchanged) ?? 0,
      indexTime: (d.indexTime ?? d.time ?? '').toString().trim(),
      raw: d
    })).filter((r) => r.indexCode);

    res.json({
      success: true,
      data,
      total: data.length,
      source: 'VPBS'
    });
  } catch (error) {
    if (error.status != null) {
      console.warn('marketIndexDetail upstream unavailable (status %s)', error.status);
      return res.status(503).json({
        success: false,
        message: 'Market data temporarily unavailable. The data provider may be down or restricting access.',
        code: 'UPSTREAM_UNAVAILABLE'
      });
    }
    console.error('marketIndexDetail error:', error.message);
    next(error);
  }
};

/**
 * GET /market/corp-bond-list
 * Danh sách trái phiếu doanh nghiệp (Neopro corpBondDetail). Query: symbols=ALL hoặc danh sách mã cách nhau dấu phẩy.
 */
export const getCorpBondList = async (req, res, next) => {
  try {
    const symbols = req.query.symbols && req.query.symbols !== '' ? String(req.query.symbols).trim() : 'ALL';
    const url = `${VPBANK_BASE_URL}/corpBondDetail?symbols=${encodeURIComponent(symbols)}`;
    const { response, data } = await fetchJson(url);
    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        message: 'Neopro corp bond API error',
        status: response.status
      });
    }
    const raw = data.data ?? data;
    const list = Array.isArray(raw) ? raw : (Array.isArray(raw?.content) ? raw.content : Array.isArray(data?.content) ? data.content : []);
    return res.json({
      success: true,
      data: list,
      raw: data
    });
  } catch (error) {
    console.error('getCorpBondList error:', error.message);
    next(error);
  }
};

/**
 * GET /market/corp-bond-info/:symbol
 * Chi tiết trái phiếu doanh nghiệp (Neopro corpBondInfo). Ví dụ: symbol=YTW12104
 */
export const getCorpBondInfo = async (req, res, next) => {
  try {
    const symbol = req.params.symbol && String(req.params.symbol).trim();
    if (!symbol) {
      return res.status(400).json({ success: false, message: 'Missing symbol' });
    }
    const url = `${VPBANK_BASE_URL}/corpBondInfo?symbol=${encodeURIComponent(symbol)}`;
    const { response, data } = await fetchJson(url);
    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        message: 'Neopro corp bond info API error',
        status: response.status
      });
    }
    return res.json({
      success: true,
      data: data.data ?? data,
      raw: data
    });
  } catch (error) {
    console.error('getCorpBondInfo error:', error.message);
    next(error);
  }
};

// Tin tức thị trường từ CafeF (cafef.vn) - tích hợp logic từ vn-stock-api-mcp
export const getCafefNews = async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 20), 100);
    const search = req.query.search ? String(req.query.search).trim() : undefined;
    const format = ['json', 'markdown', 'text'].includes(req.query.format)
      ? req.query.format
      : 'json';

    const result = await fetchCafefNews({ limit, search, format });
    const articles = Array.isArray(result?.articles) ? result.articles : [];

    if (format === 'json') {
      return res.json({
        success: true,
        source: result?.source ?? 'CafeF (cafef.vn)',
        url: result?.url ?? 'https://cafef.vn/thi-truong-chung-khoan.chn',
        total: articles.length,
        articles,
        timestamp: result?.timestamp ?? new Date().toISOString(),
        note: process.env.FIRECRAWL_API_KEY
          ? 'Data from Firecrawl API'
          : 'Data from HTML fallback (set FIRECRAWL_API_KEY for better results)'
      });
    }

    res.json({
      success: true,
      source: result?.source ?? 'CafeF (cafef.vn)',
      url: result?.url ?? 'https://cafef.vn/thi-truong-chung-khoan.chn',
      total: result?.total ?? 0,
      timestamp: result?.timestamp ?? new Date().toISOString(),
      ...(result?.markdown && { markdown: result.markdown }),
      ...(result?.text && { text: result.text }),
      note: process.env.FIRECRAWL_API_KEY
        ? 'Data from Firecrawl API'
        : 'Data from HTML fallback'
    });
  } catch (error) {
    console.error('CafeF news error:', error);
    next(error);
  }
};

/**
 * GET /market/stock-detail-by-index
 * Proxy VPBS stockDetailByIndex – bảng chi tiết theo một hoặc nhiều index.
 * Query: indexCode (string) hoặc indexCodes (string, comma-separated / array) – ví dụ indexCodes=HOSE,HNX hoặc indexCode=HOSE&indexCode=HNX.
 *        pageNo (1), pageSize (500). Khi chọn nhiều index, gộp kết quả và loại trùng theo (symbol, exchange).
 */
export const getStockDetailByIndex = async (req, res, next) => {
  try {
    const pageNo = Math.max(1, parseInt(req.query.pageNo, 10) || 1);
    const pageSize = Math.min(5000, Math.max(1, parseInt(req.query.pageSize, 10) || 500));

    // Cho phép nhiều index: indexCodes=HOSE,HNX hoặc indexCode=HOSE&indexCode=HNX
    let indexCodes = [];
    if (req.query.indexCodes != null) {
      const v = req.query.indexCodes;
      indexCodes = Array.isArray(v) ? v.map((x) => String(x).trim()) : String(v).split(',').map((s) => s.trim()).filter(Boolean);
    }
    if (req.query.indexCode != null && indexCodes.length === 0) {
      const v = req.query.indexCode;
      indexCodes = Array.isArray(v) ? v.map((x) => String(x).trim()) : [String(v).trim()].filter(Boolean);
    }
    if (indexCodes.length === 0) indexCodes = ['VNXALL'];

    const mapRow = (d) => {
      const ref = toNum(d.refPrice) ?? toNum(d.reference) ?? toNum(d.referencePrice) ?? toNum(d.basicPrice);
      const ceil = toNum(d.ceiling) ?? toNum(d.ceilingPrice);
      const floor = toNum(d.floor) ?? toNum(d.floorPrice);
      const matchPrice = toNum(d.closePrice) ?? toNum(d.matchPrice) ?? toNum(d.lastPrice) ?? toNum(d.currentPrice);
      const matchVol = toNum(d.closeVol) ?? toNum(d.totalTrading) ?? toNum(d.matchVolume) ?? toNum(d.volume) ?? toNum(d.totalTradingVolume);
      const change = toNum(d.priceChange) ?? toNum(d.change) ?? (matchPrice != null && ref != null ? matchPrice - ref : null);
      const pctChange = toNum(d.percentPriceChange) ?? toNum(d.stockPercentChange) ?? toNum(d.percentChange) ?? (ref != null && change != null ? (change / ref) * 100 : null);
      const high = toNum(d.high) ?? toNum(d.highPrice);
      const avg = toNum(d.averagePrice) ?? toNum(d.avgPrice);
      const totalVol = toNum(d.totalTrading) ?? toNum(d.totalVolume) ?? toNum(d.totalTradingVolume) ?? matchVol;

      const bid1 = toNum(d.bidPrice1) ?? toNum(d.bid1) ?? toNum(d.buyPrice1);
      const bid2 = toNum(d.bidPrice2) ?? toNum(d.bid2) ?? toNum(d.buyPrice2);
      const bid3 = toNum(d.bidPrice3) ?? toNum(d.bid3) ?? toNum(d.buyPrice3);
      const bidVol1 = toNum(d.bidVolume1) ?? toNum(d.bidVol1) ?? toNum(d.buyVolume1);
      const bidVol2 = toNum(d.bidVolume2) ?? toNum(d.bidVol2) ?? toNum(d.buyVolume2);
      const bidVol3 = toNum(d.bidVolume3) ?? toNum(d.bidVol3) ?? toNum(d.buyVolume3);
      const ask1 = toNum(d.askPrice1) ?? toNum(d.ask1) ?? toNum(d.sellPrice1);
      const ask2 = toNum(d.askPrice2) ?? toNum(d.ask2) ?? toNum(d.sellPrice2);
      const ask3 = toNum(d.askPrice3) ?? toNum(d.ask3) ?? toNum(d.sellPrice3);
      const askVol1 = toNum(d.askVolume1) ?? toNum(d.askVol1) ?? toNum(d.sellVolume1);
      const askVol2 = toNum(d.askVolume2) ?? toNum(d.askVol2) ?? toNum(d.sellVolume2);
      const askVol3 = toNum(d.askVolume3) ?? toNum(d.askVol3) ?? toNum(d.sellVolume3);

      return {
        symbol: (d.symbol ?? d.code ?? '').toString().trim(),
        exchange: (d.exchange ?? d.marketCode ?? 'HOSE').toString().trim(),
        tc: ref,
        tran: ceil,
        san: floor,
        gia3: bid3,
        kl3: bidVol3,
        gia2: bid2,
        kl2: bidVol2,
        gia1: bid1,
        kl1: bidVol1,
        matchPrice,
        matchVolume: matchVol,
        change,
        percentChange: pctChange,
        askPrice1: ask1,
        askVol1: askVol1,
        askPrice2: ask2,
        askVol2: askVol2,
        askPrice3: ask3,
        askVol3: askVol3,
        totalVolume: totalVol,
        high,
        average: avg,
        raw: d
      };
    };

    const INDEX_FALLBACK = {
      HOSE: ['VN30'],
      HNX: ['HNX30'],
      UPCOM: [],
      // Phái sinh: thử code VN30F/VN100F trước, fallback về PS market, rồi về chỉ số gốc
      VN30F:  ['VN30F', 'PS', 'VN30'],
      VN100F: ['VN100F', 'PS', 'VN100'],
    };

    const seen = new Set();
    const mergedRaw = [];
    for (const indexCode of indexCodes) {
      const toTry = [indexCode, ...(INDEX_FALLBACK[indexCode] || [])];
      for (const code of toTry) {
        const url = `${VPBANK_BASE_URL}/stockDetailByIndex?indexCode=${encodeURIComponent(code)}&pageNo=${pageNo}&pageSize=${pageSize}`;
        let json;
        try {
          ({ data: json } = await fetchJson(url));
        } catch (e) {
          continue; // skip this index if API returns HTML/error
        }
        if (json.status !== 1 && json.code !== 1) continue;
        let rawList = [];
        if (Array.isArray(json.data)) rawList = json.data;
        else if (json.data?.content) rawList = json.data.content;
        else if (json.data?.list) rawList = json.data.list;
        else if (json.data?.data) rawList = json.data.data;
        if (rawList.length > 0) {
          for (const d of rawList) {
            const sym = (d.symbol ?? d.code ?? '').toString().trim();
            const ex = (d.exchange ?? d.marketCode ?? 'HOSE').toString().trim();
            const key = `${sym}|${ex}`;
            if (seen.has(key)) continue;
            seen.add(key);
            mergedRaw.push(d);
          }
          break; // đã có dữ liệu cho index này, không thử fallback nữa
        }
      }
    }

    const data = mergedRaw.map(mapRow).filter((r) => r.symbol);

    res.json({
      success: true,
      data,
      total: data.length,
      indexCodes,
      pageNo,
      pageSize,
      source: 'VPBS'
    });
  } catch (error) {
    console.error('stockDetailByIndex error:', error.message);
    next(error);
  }
};

/**
 * GET /market/stock-cw-detail
 * Danh sách chứng quyền (Neopro stockCWDetail). Query: stockType=CW, pageNo, pageSize.
 * Trả về cùng format với stock-detail-by-index để FE dùng chung bảng giá.
 */
export const getStockCWDetail = async (req, res, next) => {
  try {
    const pageNo = Math.max(1, parseInt(req.query.pageNo, 10) || 1);
    const pageSize = Math.min(5000, Math.max(1, parseInt(req.query.pageSize, 10) || 5000));
    const stockType = (req.query.stockType && String(req.query.stockType).trim()) || 'CW';

    const mapRow = (d) => {
      const ref = toNum(d.refPrice) ?? toNum(d.reference) ?? toNum(d.referencePrice) ?? toNum(d.basicPrice);
      const ceil = toNum(d.ceiling) ?? toNum(d.ceilingPrice);
      const floor = toNum(d.floor) ?? toNum(d.floorPrice);
      const matchPrice = toNum(d.closePrice) ?? toNum(d.matchPrice) ?? toNum(d.lastPrice) ?? toNum(d.currentPrice);
      const matchVol = toNum(d.closeVol) ?? toNum(d.totalTrading) ?? toNum(d.matchVolume) ?? toNum(d.volume) ?? toNum(d.totalTradingVolume);
      const change = toNum(d.priceChange) ?? toNum(d.change) ?? (matchPrice != null && ref != null ? matchPrice - ref : null);
      const pctChange = toNum(d.percentPriceChange) ?? toNum(d.stockPercentChange) ?? toNum(d.percentChange) ?? (ref != null && change != null ? (change / ref) * 100 : null);
      const high = toNum(d.high) ?? toNum(d.highPrice);
      const avg = toNum(d.averagePrice) ?? toNum(d.avgPrice);
      const totalVol = toNum(d.totalTrading) ?? toNum(d.totalVolume) ?? toNum(d.totalTradingVolume) ?? matchVol;

      const bid1 = toNum(d.bidPrice1) ?? toNum(d.bid1) ?? toNum(d.buyPrice1);
      const bid2 = toNum(d.bidPrice2) ?? toNum(d.bid2) ?? toNum(d.buyPrice2);
      const bid3 = toNum(d.bidPrice3) ?? toNum(d.bid3) ?? toNum(d.buyPrice3);
      const bidVol1 = toNum(d.bidVolume1) ?? toNum(d.bidVol1) ?? toNum(d.buyVolume1);
      const bidVol2 = toNum(d.bidVolume2) ?? toNum(d.bidVol2) ?? toNum(d.buyVolume2);
      const bidVol3 = toNum(d.bidVolume3) ?? toNum(d.bidVol3) ?? toNum(d.buyVolume3);
      const ask1 = toNum(d.askPrice1) ?? toNum(d.ask1) ?? toNum(d.sellPrice1);
      const ask2 = toNum(d.askPrice2) ?? toNum(d.ask2) ?? toNum(d.sellPrice2);
      const ask3 = toNum(d.askPrice3) ?? toNum(d.ask3) ?? toNum(d.sellPrice3);
      const askVol1 = toNum(d.askVolume1) ?? toNum(d.askVol1) ?? toNum(d.sellVolume1);
      const askVol2 = toNum(d.askVolume2) ?? toNum(d.askVol2) ?? toNum(d.sellVolume2);
      const askVol3 = toNum(d.askVolume3) ?? toNum(d.askVol3) ?? toNum(d.sellVolume3);

      return {
        symbol: (d.symbol ?? d.code ?? '').toString().trim(),
        exchange: (d.exchange ?? d.marketCode ?? 'HOSE').toString().trim(),
        tc: ref,
        tran: ceil,
        san: floor,
        gia3: bid3,
        kl3: bidVol3,
        gia2: bid2,
        kl2: bidVol2,
        gia1: bid1,
        kl1: bidVol1,
        matchPrice,
        matchVolume: matchVol,
        change,
        percentChange: pctChange,
        askPrice1: ask1,
        askVol1: askVol1,
        askPrice2: ask2,
        askVol2: askVol2,
        askPrice3: ask3,
        askVol3: askVol3,
        totalVolume: totalVol,
        high,
        average: avg,
        raw: d
      };
    };

    const url = `${VPBANK_BASE_URL}/stockCWDetail?stockType=${encodeURIComponent(stockType)}&pageNo=${pageNo}&pageSize=${pageSize}`;
    const { response, data: json } = await fetchJson(url);

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        message: 'Neopro stock CW API error',
        status: response.status
      });
    }

    let rawList = [];
    if (Array.isArray(json.data)) rawList = json.data;
    else if (json.data?.content) rawList = json.data.content;
    else if (json.data?.list) rawList = json.data.list;
    else if (json.data?.data) rawList = json.data.data;

    const data = rawList.map(mapRow).filter((r) => r.symbol);

    res.json({
      success: true,
      data,
      total: data.length,
      pageNo,
      pageSize,
      stockType,
      source: 'VPBS'
    });
  } catch (error) {
    console.error('stockCWDetail error:', error.message);
    next(error);
  }
};

/**
 * GET /market/stock-ef-detail
 * Danh sách ETF (Neopro stockDetail?stockType=EF). Query: stockType=EF, pageNo, pageSize.
 * Trả về cùng format với stock-detail-by-index để FE dùng chung bảng giá.
 */
export const getStockEFDetail = async (req, res, next) => {
  try {
    const pageNo = Math.max(1, parseInt(req.query.pageNo, 10) || 1);
    const pageSize = Math.min(5000, Math.max(1, parseInt(req.query.pageSize, 10) || 5000));
    const stockType = (req.query.stockType && String(req.query.stockType).trim()) || 'EF';

    const url = `${VPBANK_BASE_URL}/stockDetail?stockType=${encodeURIComponent(stockType)}&pageNo=${pageNo}&pageSize=${pageSize}`;
    const { response, data: json } = await fetchJson(url);

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        message: 'Neopro stock EF (ETF) API error',
        status: response.status
      });
    }

    let rawList = [];
    if (Array.isArray(json.data?.content)) rawList = json.data.content;
    else if (Array.isArray(json.data)) rawList = json.data;
    else if (json.data?.list) rawList = json.data.list;
    else if (json.data?.data) rawList = json.data.data;

    const read = (obj, ...keys) => {
      if (obj == null || typeof obj !== 'object') return null;
      for (const k of keys) {
        const v = obj[k];
        if (v !== undefined && v !== null && v !== '') {
          const n = toNum(v);
          if (n !== null) return n;
        }
      }
      return null;
    };

    const data = rawList.map((d) => {
      const flat = d && typeof d === 'object' ? d : {};
      const n = flat.data && typeof flat.data === 'object' ? flat.data : flat;
      const ref = read(n, 'refPrice', 'reference', 'referencePrice', 'basicPrice', 'tc');
      const ceil = read(n, 'ceilingPrice', 'ceiling', 'tran');
      const floor = read(n, 'floorPrice', 'floor', 'san');
      const matchPrice = read(n, 'closePrice', 'matchPrice', 'lastPrice', 'currentPrice');
      const matchVol = read(n, 'closeVol', 'totalTrading', 'matchVolume', 'volume', 'totalTradingVolume');
      const change = read(n, 'priceChange', 'change') ?? (matchPrice != null && ref != null ? matchPrice - ref : null);
      const pctChange = read(n, 'percentPriceChange', 'stockPercentChange', 'percentChange') ?? (ref != null && change != null ? (change / ref) * 100 : null);
      const high = read(n, 'highPrice', 'high');
      const avg = read(n, 'averagePrice', 'avgPrice', 'average');
      const totalVol = read(n, 'totalTradingVolume', 'totalTrading', 'totalVolume') ?? matchVol;
      const bid1 = read(n, 'bidPrice1', 'bid1', 'buyPrice1');
      const bid2 = read(n, 'bidPrice2', 'bid2', 'buyPrice2');
      const bid3 = read(n, 'bidPrice3', 'bid3', 'buyPrice3');
      const bidVol1 = read(n, 'bidVol1', 'bidVolume1', 'buyVolume1');
      const bidVol2 = read(n, 'bidVol2', 'bidVolume2', 'buyVolume2');
      const bidVol3 = read(n, 'bidVol3', 'bidVolume3', 'buyVolume3');
      const ask1 = read(n, 'askPrice1', 'ask1', 'sellPrice1');
      const ask2 = read(n, 'askPrice2', 'ask2', 'sellPrice2');
      const ask3 = read(n, 'askPrice3', 'ask3', 'sellPrice3');
      const askVol1 = read(n, 'askVol1', 'askVolume1', 'sellVolume1');
      const askVol2 = read(n, 'askVol2', 'askVolume2', 'sellVolume2');
      const askVol3 = read(n, 'askVol3', 'askVolume3', 'sellVolume3');
      const sym = (n.symbol ?? flat.symbol ?? n.code ?? flat.code ?? '').toString().trim();
      const exc = (n.exchange ?? flat.exchange ?? n.marketCode ?? flat.marketCode ?? 'HOSE').toString().trim();
      return {
        symbol: sym,
        exchange: exc,
        tc: ref,
        tran: ceil,
        san: floor,
        gia3: bid3,
        kl3: bidVol3,
        gia2: bid2,
        kl2: bidVol2,
        gia1: bid1,
        kl1: bidVol1,
        matchPrice,
        matchVolume: matchVol,
        change,
        percentChange: pctChange,
        askPrice1: ask1,
        askVol1: askVol1,
        askPrice2: ask2,
        askVol2: askVol2,
        askPrice3: ask3,
        askVol3: askVol3,
        totalVolume: totalVol,
        high,
        average: avg,
        raw: d
      };
    }).filter((r) => r.symbol);

    res.json({
      success: true,
      data,
      total: data.length,
      pageNo,
      pageSize,
      stockType,
      source: 'VPBS'
    });
  } catch (error) {
    console.error('stockDetail EF error:', error.message);
    next(error);
  }
};

const FU_STOCK_TYPES = ['FUVN30', 'FUVN100', 'FUGB'];

/**
 * GET /market/stock-fu-detail
 * Danh sách phái sinh (Neopro fuStockDetail). Query: stockType=FUVN30|FUVN100|FUGB, pageNo, pageSize.
 * Trả về cùng format với stock-detail-by-index để FE dùng chung bảng giá.
 */
export const getStockFUDetail = async (req, res, next) => {
  try {
    const pageNo = Math.max(1, parseInt(req.query.pageNo, 10) || 1);
    const pageSize = Math.min(5000, Math.max(1, parseInt(req.query.pageSize, 10) || 5000));
    let stockType = (req.query.stockType && String(req.query.stockType).trim().toUpperCase()) || 'FUVN30';
    if (!FU_STOCK_TYPES.includes(stockType)) stockType = 'FUVN30';

    const mapRow = (d) => {
      const ref = toNum(d.refPrice) ?? toNum(d.reference) ?? toNum(d.referencePrice) ?? toNum(d.basicPrice);
      const ceil = toNum(d.ceiling) ?? toNum(d.ceilingPrice);
      const floor = toNum(d.floor) ?? toNum(d.floorPrice);
      const matchPrice = toNum(d.closePrice) ?? toNum(d.matchPrice) ?? toNum(d.lastPrice) ?? toNum(d.currentPrice);
      const matchVol = toNum(d.closeVol) ?? toNum(d.totalTrading) ?? toNum(d.matchVolume) ?? toNum(d.volume) ?? toNum(d.totalTradingVolume);
      const change = toNum(d.priceChange) ?? toNum(d.change) ?? (matchPrice != null && ref != null ? matchPrice - ref : null);
      const pctChange = toNum(d.percentPriceChange) ?? toNum(d.stockPercentChange) ?? toNum(d.percentChange) ?? (ref != null && change != null ? (change / ref) * 100 : null);
      const high = toNum(d.high) ?? toNum(d.highPrice);
      const avg = toNum(d.averagePrice) ?? toNum(d.avgPrice);
      const totalVol = toNum(d.totalTrading) ?? toNum(d.totalVolume) ?? toNum(d.totalTradingVolume) ?? matchVol;

      const bid1 = toNum(d.bidPrice1) ?? toNum(d.bid1) ?? toNum(d.buyPrice1);
      const bid2 = toNum(d.bidPrice2) ?? toNum(d.bid2) ?? toNum(d.buyPrice2);
      const bid3 = toNum(d.bidPrice3) ?? toNum(d.bid3) ?? toNum(d.buyPrice3);
      const bidVol1 = toNum(d.bidVolume1) ?? toNum(d.bidVol1) ?? toNum(d.buyVolume1);
      const bidVol2 = toNum(d.bidVolume2) ?? toNum(d.bidVol2) ?? toNum(d.buyVolume2);
      const bidVol3 = toNum(d.bidVolume3) ?? toNum(d.bidVol3) ?? toNum(d.buyVolume3);
      const ask1 = toNum(d.askPrice1) ?? toNum(d.ask1) ?? toNum(d.sellPrice1);
      const ask2 = toNum(d.askPrice2) ?? toNum(d.ask2) ?? toNum(d.sellPrice2);
      const ask3 = toNum(d.askPrice3) ?? toNum(d.ask3) ?? toNum(d.sellPrice3);
      const askVol1 = toNum(d.askVolume1) ?? toNum(d.askVol1) ?? toNum(d.sellVolume1);
      const askVol2 = toNum(d.askVolume2) ?? toNum(d.askVol2) ?? toNum(d.sellVolume2);
      const askVol3 = toNum(d.askVolume3) ?? toNum(d.askVol3) ?? toNum(d.sellVolume3);

      return {
        symbol: (d.symbol ?? d.code ?? '').toString().trim(),
        exchange: (d.exchange ?? d.marketCode ?? 'HOSE').toString().trim(),
        tc: ref,
        tran: ceil,
        san: floor,
        gia3: bid3,
        kl3: bidVol3,
        gia2: bid2,
        kl2: bidVol2,
        gia1: bid1,
        kl1: bidVol1,
        matchPrice,
        matchVolume: matchVol,
        change,
        percentChange: pctChange,
        askPrice1: ask1,
        askVol1: askVol1,
        askPrice2: ask2,
        askVol2: askVol2,
        askPrice3: ask3,
        askVol3: askVol3,
        totalVolume: totalVol,
        high,
        average: avg,
        raw: d
      };
    };

    const url = `${VPBANK_BASE_URL}/fuStockDetail?stockType=${encodeURIComponent(stockType)}&pageNo=${pageNo}&pageSize=${pageSize}`;
    const { response, data: json } = await fetchJson(url);

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        message: 'Neopro fuStockDetail API error',
        status: response.status
      });
    }

    let rawList = [];
    if (Array.isArray(json.data)) rawList = json.data;
    else if (json.data?.content) rawList = json.data.content;
    else if (json.data?.list) rawList = json.data.list;
    else if (json.data?.data) rawList = json.data.data;

    const data = rawList.map(mapRow).filter((r) => r.symbol);

    res.json({
      success: true,
      data,
      total: data.length,
      pageNo,
      pageSize,
      stockType,
      source: 'VPBS'
    });
  } catch (error) {
    console.error('stockFUDetail error:', error.message);
    next(error);
  }
};

/**
 * GET /market/stock-detail-by-industry
 * Danh sách CP theo ngành (Neopro stockDetailByIndustry). Query: industryCode (bắt buộc), pageNo, pageSize.
 * Trả về cùng format với stock-detail-by-index để FE dùng chung bảng giá.
 */
export const getStockDetailByIndustry = async (req, res, next) => {
  try {
    const industryCode = req.query.industryCode && String(req.query.industryCode).trim();
    if (!industryCode) {
      return res.status(400).json({ success: false, message: 'industryCode is required' });
    }
    const pageNo = Math.max(1, parseInt(req.query.pageNo, 10) || 1);
    const pageSize = Math.min(5000, Math.max(1, parseInt(req.query.pageSize, 10) || 5000));

    const mapRow = (d) => {
      const ref = toNum(d.refPrice) ?? toNum(d.reference) ?? toNum(d.referencePrice) ?? toNum(d.basicPrice);
      const ceil = toNum(d.ceiling) ?? toNum(d.ceilingPrice);
      const floor = toNum(d.floor) ?? toNum(d.floorPrice);
      const matchPrice = toNum(d.closePrice) ?? toNum(d.matchPrice) ?? toNum(d.lastPrice) ?? toNum(d.currentPrice);
      const matchVol = toNum(d.closeVol) ?? toNum(d.totalTrading) ?? toNum(d.matchVolume) ?? toNum(d.volume) ?? toNum(d.totalTradingVolume);
      const change = toNum(d.priceChange) ?? toNum(d.change) ?? (matchPrice != null && ref != null ? matchPrice - ref : null);
      const pctChange = toNum(d.percentPriceChange) ?? toNum(d.stockPercentChange) ?? toNum(d.percentChange) ?? (ref != null && change != null ? (change / ref) * 100 : null);
      const high = toNum(d.high) ?? toNum(d.highPrice);
      const avg = toNum(d.averagePrice) ?? toNum(d.avgPrice);
      const totalVol = toNum(d.totalTrading) ?? toNum(d.totalVolume) ?? toNum(d.totalTradingVolume) ?? matchVol;

      const bid1 = toNum(d.bidPrice1) ?? toNum(d.bid1) ?? toNum(d.buyPrice1);
      const bid2 = toNum(d.bidPrice2) ?? toNum(d.bid2) ?? toNum(d.buyPrice2);
      const bid3 = toNum(d.bidPrice3) ?? toNum(d.bid3) ?? toNum(d.buyPrice3);
      const bidVol1 = toNum(d.bidVolume1) ?? toNum(d.bidVol1) ?? toNum(d.buyVolume1);
      const bidVol2 = toNum(d.bidVolume2) ?? toNum(d.bidVol2) ?? toNum(d.buyVolume2);
      const bidVol3 = toNum(d.bidVolume3) ?? toNum(d.bidVol3) ?? toNum(d.buyVolume3);
      const ask1 = toNum(d.askPrice1) ?? toNum(d.ask1) ?? toNum(d.sellPrice1);
      const ask2 = toNum(d.askPrice2) ?? toNum(d.ask2) ?? toNum(d.sellPrice2);
      const ask3 = toNum(d.askPrice3) ?? toNum(d.ask3) ?? toNum(d.sellPrice3);
      const askVol1 = toNum(d.askVolume1) ?? toNum(d.askVol1) ?? toNum(d.sellVolume1);
      const askVol2 = toNum(d.askVolume2) ?? toNum(d.askVol2) ?? toNum(d.sellVolume2);
      const askVol3 = toNum(d.askVolume3) ?? toNum(d.askVol3) ?? toNum(d.sellVolume3);

      return {
        symbol: (d.symbol ?? d.code ?? '').toString().trim(),
        exchange: (d.exchange ?? d.marketCode ?? 'HOSE').toString().trim(),
        tc: ref,
        tran: ceil,
        san: floor,
        gia3: bid3,
        kl3: bidVol3,
        gia2: bid2,
        kl2: bidVol2,
        gia1: bid1,
        kl1: bidVol1,
        matchPrice,
        matchVolume: matchVol,
        change,
        percentChange: pctChange,
        askPrice1: ask1,
        askVol1: askVol1,
        askPrice2: ask2,
        askVol2: askVol2,
        askPrice3: ask3,
        askVol3: askVol3,
        totalVolume: totalVol,
        high,
        average: avg,
        raw: d
      };
    };

    const url = `${VPBANK_BASE_URL}/stockDetailByIndustry?industryCode=${encodeURIComponent(industryCode)}&pageNo=${pageNo}&pageSize=${pageSize}`;
    const { response, data: json } = await fetchJson(url);

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        message: 'Neopro stockDetailByIndustry API error',
        status: response.status
      });
    }

    let rawList = [];
    if (Array.isArray(json.data)) rawList = json.data;
    else if (json.data?.content) rawList = json.data.content;
    else if (json.data?.list) rawList = json.data.list;
    else if (json.data?.data) rawList = json.data.data;

    const data = rawList.map(mapRow).filter((r) => r.symbol);

    res.json({
      success: true,
      data,
      total: data.length,
      industryCode,
      pageNo,
      pageSize,
      source: 'VPBS'
    });
  } catch (error) {
    console.error('stockDetailByIndustry error:', error.message);
    next(error);
  }
};

const PT_MARKET_CODES = ['HOSE', 'HNX', 'UPCOM'];

/**
 * GET /market/pt-stock-match
 * Khớp lệnh thoả thuận (Neopro ptStockMatch). Query: marketCode=HOSE|HNX|UPCOM.
 * Trả về danh sách giao dịch khớp: symbol, price, volume, value, time.
 */
export const getPtStockMatch = async (req, res, next) => {
  try {
    let marketCode = (req.query.marketCode && String(req.query.marketCode).trim().toUpperCase()) || 'HOSE';
    if (!PT_MARKET_CODES.includes(marketCode)) marketCode = 'HOSE';

    const url = `${VPBANK_BASE_URL}/ptStockMatch?marketCode=${encodeURIComponent(marketCode)}`;
    const { response, data: json } = await fetchJson(url);

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        message: 'Neopro ptStockMatch API error',
        status: response.status
      });
    }

    let rawList = [];
    if (Array.isArray(json.data?.tradingInfos)) rawList = json.data.tradingInfos;
    else if (Array.isArray(json.data)) rawList = json.data;
    else if (json.data?.content) rawList = json.data.content;
    else if (json.data?.list) rawList = json.data.list;
    else if (json.data?.data) rawList = json.data.data;
    else if (Array.isArray(json.tradingInfos)) rawList = json.tradingInfos;

    const data = rawList.map((d) => {
      const price = toNum(d.price) ?? toNum(d.matchPrice) ?? toNum(d.lastPrice);
      const volume = toNum(d.matchVol) ?? toNum(d.volume) ?? toNum(d.matchVolume) ?? toNum(d.quantity) ?? toNum(d.kl);
      const value = toNum(d.value) ?? toNum(d.totalValue) ?? toNum(d.giaTri) ?? (price != null && volume != null ? price * volume : null);
      return {
        symbol: (d.symbol ?? d.code ?? '').toString().trim(),
        price,
        volume,
        value,
        time: (d.time ?? d.matchTime ?? d.tradingTime ?? d.thoiGian ?? '').toString().trim(),
        refPrice: toNum(d.refPrice) ?? toNum(d.referencePrice),
        ceilingPrice: toNum(d.ceilingPrice),
        floorPrice: toNum(d.floorPrice),
        tradingDate: (d.tradingDate ?? '').toString().trim(),
        raw: d
      };
    }).filter((r) => r.symbol);

    res.json({
      success: true,
      data,
      total: data.length,
      marketCode,
      totalTradingVolume: json.data?.totalTradingVolume ?? null,
      totalTradingValue: json.data?.totalTradingValue ?? null,
      source: 'VPBS'
    });
  } catch (error) {
    console.error('ptStockMatch error:', error.message);
    next(error);
  }
};

/**
 * GET /market/pt-stock-bid
 * Chào mua thoả thuận. Neopro có thể có endpoint riêng; tạm trả [] nếu không có.
 * Format trả về: [{ symbol, price, volume, time }].
 */
export const getPtStockBid = async (req, res, next) => {
  try {
    let marketCode = (req.query.marketCode && String(req.query.marketCode).trim().toUpperCase()) || 'HOSE';
    if (!PT_MARKET_CODES.includes(marketCode)) marketCode = 'HOSE';
    const url = `${VPBANK_BASE_URL}/ptStockBid?marketCode=${encodeURIComponent(marketCode)}`;
    let json = {};
    let fetchOk = false;
    try {
      const result = await fetchJson(url);
      json = result.data;
      fetchOk = result.response.ok;
    } catch {
      // fetchJson throws on HTML/invalid JSON — fallback to empty object
    }
    let rawList = [];
    if (fetchOk && json.data != null) {
      if (Array.isArray(json.data)) rawList = json.data;
      else if (Array.isArray(json.data?.content)) rawList = json.data.content;
      else if (Array.isArray(json.data?.list)) rawList = json.data.list;
      else if (Array.isArray(json.data?.data)) rawList = json.data.data;
      else if (Array.isArray(json.data?.bidInfos)) rawList = json.data.bidInfos;
    }
    const data = rawList.map((d) => ({
      symbol: (d.symbol ?? d.code ?? '').toString().trim(),
      price: toNum(d.price ?? d.bidPrice),
      volume: toNum(d.volume ?? d.quantity ?? d.bidVol ?? d.matchVol),
      time: (d.time ?? d.matchTime ?? '').toString().trim(),
      raw: d
    })).filter((r) => r.symbol);
    res.json({ success: true, data, total: data.length, marketCode, source: 'VPBS' });
  } catch (error) {
    console.error('ptStockBid error:', error.message);
    res.json({ success: true, data: [], total: 0, marketCode: req.query.marketCode || 'HOSE', source: 'VPBS' });
  }
};

/**
 * GET /market/pt-stock-ask
 * Chào bán thoả thuận. Neopro có thể có endpoint riêng; tạm trả [] nếu không có.
 * Format trả về: [{ symbol, price, volume, time }].
 */
export const getPtStockAsk = async (req, res, next) => {
  try {
    let marketCode = (req.query.marketCode && String(req.query.marketCode).trim().toUpperCase()) || 'HOSE';
    if (!PT_MARKET_CODES.includes(marketCode)) marketCode = 'HOSE';
    const url = `${VPBANK_BASE_URL}/ptStockAsk?marketCode=${encodeURIComponent(marketCode)}`;
    let json = {};
    let fetchOk = false;
    try {
      const result = await fetchJson(url);
      json = result.data;
      fetchOk = result.response.ok;
    } catch {
      // fetchJson throws on HTML/invalid JSON — fallback to empty object
    }
    let rawList = [];
    if (fetchOk && json.data != null) {
      if (Array.isArray(json.data)) rawList = json.data;
      else if (Array.isArray(json.data?.content)) rawList = json.data.content;
      else if (Array.isArray(json.data?.list)) rawList = json.data.list;
      else if (Array.isArray(json.data?.data)) rawList = json.data.data;
      else if (Array.isArray(json.data?.askInfos)) rawList = json.data.askInfos;
    }
    const data = rawList.map((d) => ({
      symbol: (d.symbol ?? d.code ?? '').toString().trim(),
      price: toNum(d.price ?? d.askPrice),
      volume: toNum(d.volume ?? d.quantity ?? d.askVol ?? d.matchVol),
      time: (d.time ?? d.matchTime ?? '').toString().trim(),
      raw: d
    })).filter((r) => r.symbol);
    res.json({ success: true, data, total: data.length, marketCode, source: 'VPBS' });
  } catch (error) {
    console.error('ptStockAsk error:', error.message);
    res.json({ success: true, data: [], total: 0, marketCode: req.query.marketCode || 'HOSE', source: 'VPBS' });
  }
};

/**
 * GET /market/pt-stock-detail
 * Chi tiết thoả thuận (Neopro ptStockDetail). Query: marketCode=HOSE|HNX|UPCOM.
 * Trả về danh sách mã có giao dịch thoả thuận (format tương thích bảng giá nếu API trả đủ field).
 */
export const getPtStockDetail = async (req, res, next) => {
  try {
    let marketCode = (req.query.marketCode && String(req.query.marketCode).trim().toUpperCase()) || 'HOSE';
    if (!PT_MARKET_CODES.includes(marketCode)) marketCode = 'HOSE';

    const url = `${VPBANK_BASE_URL}/ptStockDetail?marketCode=${encodeURIComponent(marketCode)}`;
    const { response, data: json } = await fetchJson(url);

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        message: 'Neopro ptStockDetail API error',
        status: response.status
      });
    }

    let rawList = [];
    if (Array.isArray(json.data)) rawList = json.data;
    else if (json.data?.content) rawList = json.data.content;
    else if (json.data?.list) rawList = json.data.list;
    else if (json.data?.data) rawList = json.data.data;

    const data = rawList.map((d) => {
      const ref = toNum(d.refPrice) ?? toNum(d.reference) ?? toNum(d.referencePrice);
      const matchPrice = toNum(d.closePrice) ?? toNum(d.matchPrice) ?? toNum(d.lastPrice) ?? toNum(d.price);
      const matchVol = toNum(d.closeVol) ?? toNum(d.totalTrading) ?? toNum(d.matchVolume) ?? toNum(d.volume);
      const change = toNum(d.priceChange) ?? toNum(d.change) ?? (matchPrice != null && ref != null ? matchPrice - ref : null);
      const pctChange = toNum(d.percentPriceChange) ?? toNum(d.percentChange) ?? (ref != null && change != null ? (change / ref) * 100 : null);
      return {
        symbol: (d.symbol ?? d.code ?? '').toString().trim(),
        exchange: (d.exchange ?? d.marketCode ?? marketCode).toString().trim(),
        tc: ref,
        tran: toNum(d.ceiling) ?? toNum(d.ceilingPrice),
        san: toNum(d.floor) ?? toNum(d.floorPrice),
        matchPrice,
        matchVolume: matchVol,
        change,
        percentChange: pctChange,
        totalVolume: toNum(d.totalTrading) ?? toNum(d.totalVolume) ?? matchVol,
        high: toNum(d.high) ?? toNum(d.highPrice),
        average: toNum(d.averagePrice) ?? toNum(d.avgPrice),
        raw: d
      };
    }).filter((r) => r.symbol);

    res.json({
      success: true,
      data,
      total: data.length,
      marketCode,
      source: 'VPBS'
    });
  } catch (error) {
    console.error('ptStockDetail error:', error.message);
    next(error);
  }
};

/**
 * GET /market/odd-lot-stock-detail
 * Chi tiết lô lẻ (Neopro oddLotStockDetail). Query: marketCode=HOSE|HNX|UPCOM, pageNo, pageSize.
 * Trả về danh sách mã lô lẻ, format tương thích bảng giá.
 */
export const getOddLotStockDetail = async (req, res, next) => {
  try {
    let marketCode = (req.query.marketCode && String(req.query.marketCode).trim().toUpperCase()) || 'HOSE';
    if (!PT_MARKET_CODES.includes(marketCode)) marketCode = 'HOSE';
    const pageNo = Math.max(1, parseInt(req.query.pageNo, 10) || 1);
    const pageSize = Math.min(5000, Math.max(1, parseInt(req.query.pageSize, 10) || 5000));

    const url = `${VPBANK_BASE_URL}/oddLotStockDetail?marketCode=${encodeURIComponent(marketCode)}&pageNo=${pageNo}&pageSize=${pageSize}`;
    const { response, data: json } = await fetchJson(url);

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        message: 'Neopro oddLotStockDetail API error',
        status: response.status
      });
    }

    let rawList = [];
    if (Array.isArray(json.data?.content)) rawList = json.data.content;
    else if (Array.isArray(json.data)) rawList = json.data;
    else if (json.data?.list) rawList = json.data.list;
    else if (json.data?.data) rawList = json.data.data;

    const read = (obj, ...keys) => {
      if (obj == null || typeof obj !== 'object') return null;
      for (const k of keys) {
        const v = obj[k];
        if (v !== undefined && v !== null && v !== '') {
          const n = toNum(v);
          if (n !== null) return n;
        }
      }
      return null;
    };

    const data = rawList.map((d) => {
      const flat = d && typeof d === 'object' ? d : {};
      const n = flat.data && typeof flat.data === 'object' ? flat.data : flat;
      const ref = read(n, 'refPrice', 'reference', 'referencePrice', 'basicPrice', 'tc');
      const ceil = read(n, 'ceilingPrice', 'ceiling', 'tran');
      const floor = read(n, 'floorPrice', 'floor', 'san');
      const matchPrice = read(n, 'closePrice', 'matchPrice', 'lastPrice', 'currentPrice');
      const matchVol = read(n, 'closeVol', 'totalTrading', 'matchVolume', 'volume', 'totalTradingVolume');
      const change = read(n, 'priceChange', 'change') ?? (matchPrice != null && ref != null ? matchPrice - ref : null);
      const pctChange = read(n, 'percentPriceChange', 'stockPercentChange', 'percentChange') ?? (ref != null && change != null ? (change / ref) * 100 : null);
      const high = read(n, 'highPrice', 'high');
      const avg = read(n, 'averagePrice', 'avgPrice', 'average');
      const totalVol = read(n, 'totalTradingVolume', 'totalTrading', 'totalVolume') ?? matchVol;
      const bid1 = read(n, 'bidPrice1', 'bid1', 'buyPrice1');
      const bid2 = read(n, 'bidPrice2', 'bid2', 'buyPrice2');
      const bid3 = read(n, 'bidPrice3', 'bid3', 'buyPrice3');
      const bidVol1 = read(n, 'bidVol1', 'bidVolume1', 'buyVolume1');
      const bidVol2 = read(n, 'bidVol2', 'bidVolume2', 'buyVolume2');
      const bidVol3 = read(n, 'bidVol3', 'bidVolume3', 'buyVolume3');
      const ask1 = read(n, 'askPrice1', 'ask1', 'sellPrice1');
      const ask2 = read(n, 'askPrice2', 'ask2', 'sellPrice2');
      const ask3 = read(n, 'askPrice3', 'ask3', 'sellPrice3');
      const askVol1 = read(n, 'askVol1', 'askVolume1', 'sellVolume1');
      const askVol2 = read(n, 'askVol2', 'askVolume2', 'sellVolume2');
      const askVol3 = read(n, 'askVol3', 'askVolume3', 'sellVolume3');
      const sym = (n.symbol ?? flat.symbol ?? n.code ?? flat.code ?? '').toString().trim();
      const exc = (n.exchange ?? flat.exchange ?? n.marketCode ?? flat.marketCode ?? marketCode).toString().trim();
      return {
        symbol: sym,
        exchange: exc,
        tc: ref,
        tran: ceil,
        san: floor,
        gia3: bid3,
        kl3: bidVol3,
        gia2: bid2,
        kl2: bidVol2,
        gia1: bid1,
        kl1: bidVol1,
        matchPrice,
        matchVolume: matchVol,
        change,
        percentChange: pctChange,
        askPrice1: ask1,
        askVol1: askVol1,
        askPrice2: ask2,
        askVol2: askVol2,
        askPrice3: ask3,
        askVol3: askVol3,
        totalVolume: totalVol,
        high,
        average: avg,
        raw: d
      };
    }).filter((r) => r.symbol);

    res.json({
      success: true,
      data,
      total: data.length,
      marketCode,
      pageNo,
      pageSize,
      source: 'VPBS'
    });
  } catch (error) {
    console.error('oddLotStockDetail error:', error.message);
    next(error);
  }
};

export default {
  getSymbols,
  getSymbolInfo,
  getPositionFormSpec,
  getEntryInfo,
  getPrice,
  getOHLCV,
  getIndicators,
  getOverview,
  getStocks,
  getSymbolDetail,
  getStockDetailByIndex,
  getStockCWDetail,
  getStockEFDetail,
  getStockDetailByIndustry,
  getPtStockMatch,
  getPtStockBid,
  getPtStockAsk,
  getPtStockDetail,
  getOddLotStockDetail,
  getCompanyInfo,
  getShareholders,
  getAdvancedInfo,
  getIntradayOHLCV,
  getMatchingHistory,
  getOrderBook,
  getIntradayMarketIndex,
  getIntradayMarketIndices,
  getMarketIndexDetail,
  getCafefNews,
  getCorpBondList,
  getCorpBondInfo,
  ohlcvQuerySchema
};
