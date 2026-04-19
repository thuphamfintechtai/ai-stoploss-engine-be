/**
 * vnMarketRules — Source of truth duy nhất cho quy tắc thị trường VN.
 * Unit: VND integer toàn bộ. FE convert sang điểm ở display layer.
 *
 * Sàn HOSE / HNX / UPCOM — F0 scope.
 *
 * Exports:
 *   Tick:    getTickSize, snapToTick, isValidTick
 *   Lot:     getLotSize, validateLotSize
 *   Band:    getPriceBand, validatePriceInBand
 *   Session: getMarketSession, isMarketOpen
 *   Errors:  ERRORS
 */

// ─── Rule tables (LOCKED — CONTEXT.md §decisions) ──────────────────────────

const TICK_TABLE = {
  HOSE: [
    { maxPrice: 9_999,    tick: 10  },
    { maxPrice: 49_950,   tick: 50  },
    { maxPrice: Infinity, tick: 100 },
  ],
  HNX:   [{ maxPrice: Infinity, tick: 100 }],
  UPCOM: [{ maxPrice: Infinity, tick: 100 }],
};

const LOT_SIZE = { HOSE: 100, HNX: 100, UPCOM: 100 };

const PRICE_BAND_PCT = { HOSE: 0.07, HNX: 0.10, UPCOM: 0.15 };

// Session boundaries theo phút-trong-ngày (VN time UTC+7).
// Format: [cutoffMinute, sessionName] — đọc theo thứ tự first-match-wins (minutes < cutoff).
const SESSION_TABLE = {
  HOSE: [
    [ 9*60,        'PRE_OPEN'     ],
    [ 9*60 + 15,   'ATO'          ],
    [11*60 + 30,   'CONTINUOUS_1' ],
    [13*60,        'LUNCH'        ],
    [14*60 + 30,   'CONTINUOUS_2' ],
    [14*60 + 45,   'ATC'          ],
    [15*60,        'PUT_THROUGH'  ],
    [24*60,        'CLOSED'       ],
  ],
  HNX: [
    [ 9*60,        'PRE_OPEN'     ],
    [ 9*60 + 15,   'ATO'          ],
    [11*60 + 30,   'CONTINUOUS_1' ],
    [13*60,        'LUNCH'        ],
    [14*60 + 30,   'CONTINUOUS_2' ],
    [14*60 + 45,   'ATC'          ],
    [15*60,        'PUT_THROUGH'  ],
    [24*60,        'CLOSED'       ],
  ],
  UPCOM: [
    [ 9*60,        'PRE_OPEN'     ],
    [11*60 + 30,   'CONTINUOUS_1' ],
    [13*60,        'LUNCH'        ],
    [15*60,        'CONTINUOUS_2' ],
    [24*60,        'CLOSED'       ],
  ],
};

// Error messages — Vietnamese user-facing (LOCKED)
export const ERRORS = {
  LOT_INVALID: 'Khối lượng phải là bội số 100 (tối thiểu 100 CP)',
  TICK_INVALID: (tick, exchange) =>
    `Giá phải là bội số ${tick}đ theo quy tắc sàn ${exchange}`,
  BAND_INVALID: (price, floor, ceiling, exchange) =>
    `Giá ${price.toLocaleString('vi-VN')}đ ngoài biên độ ngày. Sàn ${exchange} cho phép ${floor.toLocaleString('vi-VN')}-${ceiling.toLocaleString('vi-VN')}đ`,
  MARKET_CLOSED: (nextSession, time) =>
    `Thị trường đóng cửa. Phiên ${nextSession} mở lúc ${time}`,
};

const OPEN_SESSIONS = new Set(['ATO', 'CONTINUOUS_1', 'CONTINUOUS_2', 'ATC']);

// ─── Tick helpers ──────────────────────────────────────────────────────────

/**
 * Lấy bước giá (tick) cho một mức giá + sàn.
 * @param {number} priceVnd
 * @param {string} [exchange='HOSE'] - HOSE | HNX | UPCOM
 * @returns {number} VND
 */
export function getTickSize(priceVnd, exchange = 'HOSE') {
  const rules = TICK_TABLE[exchange] ?? TICK_TABLE.HOSE;
  const rule = rules.find(r => priceVnd <= r.maxPrice);
  return rule?.tick ?? 100;
}

/**
 * Snap giá về tick hợp lệ theo chiều cho trước.
 * @param {number} priceVnd
 * @param {string} [exchange='HOSE']
 * @param {'nearest'|'up'|'down'} [direction='nearest']
 * @returns {number}
 */
export function snapToTick(priceVnd, exchange = 'HOSE', direction = 'nearest') {
  const tick = getTickSize(priceVnd, exchange);
  if (direction === 'up')   return Math.ceil(priceVnd / tick)  * tick;
  if (direction === 'down') return Math.floor(priceVnd / tick) * tick;
  return Math.round(priceVnd / tick) * tick;
}

/**
 * Kiểm tra giá có đúng tick không.
 * @param {number} priceVnd
 * @param {string} [exchange='HOSE']
 * @returns {boolean}
 */
export function isValidTick(priceVnd, exchange = 'HOSE') {
  return priceVnd === snapToTick(priceVnd, exchange, 'nearest');
}

// ─── Lot helpers ───────────────────────────────────────────────────────────

/**
 * Lô giao dịch tối thiểu theo sàn.
 * @param {string} [exchange='HOSE']
 * @returns {number} Số CP tối thiểu (100 cho HOSE/HNX/UPCOM F0).
 */
export function getLotSize(exchange = 'HOSE') {
  return LOT_SIZE[exchange] ?? 100;
}

/**
 * Kiểm tra khối lượng đặt lệnh hợp lệ.
 * @param {number} qty
 * @param {string} [exchange='HOSE']
 * @returns {{ok: boolean, reason?: string}}
 */
export function validateLotSize(qty, exchange = 'HOSE') {
  const lot = getLotSize(exchange);
  if (!Number.isInteger(qty) || qty <= 0 || qty % lot !== 0) {
    return { ok: false, reason: ERRORS.LOT_INVALID };
  }
  return { ok: true };
}

// ─── Price band helpers ────────────────────────────────────────────────────

/**
 * Biên độ giao dịch ngày (ceiling/floor), snap về tick hợp lệ.
 * Ceiling snap DOWN để không vượt raw band, floor snap UP để không thấp hơn raw band.
 * @param {number} referenceVnd - Giá tham chiếu (close phiên trước)
 * @param {string} [exchange='HOSE']
 * @returns {{floor: number, ceiling: number, pct: number, reference: number}}
 */
export function getPriceBand(referenceVnd, exchange = 'HOSE') {
  const pct = PRICE_BAND_PCT[exchange] ?? 0.07;
  const rawFloor   = referenceVnd * (1 - pct);
  const rawCeiling = referenceVnd * (1 + pct);
  return {
    floor:     snapToTick(Math.ceil(rawFloor),    exchange, 'up'),
    ceiling:   snapToTick(Math.floor(rawCeiling), exchange, 'down'),
    pct,
    reference: referenceVnd,
  };
}

/**
 * Kiểm tra giá trong biên độ ngày.
 * @param {number} priceVnd
 * @param {string} [exchange='HOSE']
 * @param {number} referenceVnd
 * @returns {{ok: boolean, reason?: string, floor?: number, ceiling?: number}}
 */
export function validatePriceInBand(priceVnd, exchange = 'HOSE', referenceVnd) {
  if (!referenceVnd || referenceVnd <= 0) return { ok: true };
  const { floor, ceiling } = getPriceBand(referenceVnd, exchange);
  if (priceVnd < floor || priceVnd > ceiling) {
    return {
      ok: false,
      reason: ERRORS.BAND_INVALID(priceVnd, floor, ceiling, exchange),
      floor,
      ceiling,
    };
  }
  return { ok: true, floor, ceiling };
}

// ─── Session helpers ───────────────────────────────────────────────────────

/**
 * Tính phút-trong-ngày theo VN time (UTC+7).
 * @param {Date} [now]
 * @returns {{day: number, minutes: number}}
 */
function _minutesInVN(now) {
  const d = now ?? new Date();
  const vnTime = new Date(d.getTime() + 7 * 3600_000);
  return {
    day: vnTime.getUTCDay(), // 0=CN, 6=T7
    minutes: vnTime.getUTCHours() * 60 + vnTime.getUTCMinutes(),
  };
}

/**
 * Xác định phiên giao dịch hiện tại của sàn.
 * @param {string} [exchange='HOSE']
 * @param {Date} [now=new Date()]
 * @returns {'PRE_OPEN'|'ATO'|'CONTINUOUS_1'|'LUNCH'|'CONTINUOUS_2'|'ATC'|'PUT_THROUGH'|'CLOSED'}
 */
export function getMarketSession(exchange = 'HOSE', now = new Date()) {
  const { day, minutes } = _minutesInVN(now);
  if (day === 0 || day === 6) return 'CLOSED';
  const table = SESSION_TABLE[exchange] ?? SESSION_TABLE.HOSE;
  for (const [cutoff, name] of table) {
    if (minutes < cutoff) return name;
  }
  return 'CLOSED';
}

/**
 * Thị trường có đang mở khớp lệnh không.
 * True khi session ∈ {ATO, CONTINUOUS_1, CONTINUOUS_2, ATC}.
 * @param {string} [exchange='HOSE']
 * @param {Date} [now=new Date()]
 * @returns {boolean}
 */
export function isMarketOpen(exchange = 'HOSE', now = new Date()) {
  return OPEN_SESSIONS.has(getMarketSession(exchange, now));
}

// ─── Backward-compat aliases (cho consumer cũ) ─────────────────────────────

export const snapToTickSize = (p, ex) => snapToTick(p, ex, 'nearest');
export const isValidTickSize = isValidTick;

export default {
  getTickSize, snapToTick, snapToTickSize, isValidTick, isValidTickSize,
  getLotSize, validateLotSize,
  getPriceBand, validatePriceInBand,
  getMarketSession, isMarketOpen,
  ERRORS,
};
