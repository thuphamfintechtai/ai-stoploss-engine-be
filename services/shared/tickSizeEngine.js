/**
 * Tick Size Engine — Quy tắc bước giá theo từng sàn VN.
 *
 * HOSE:
 *   < 10,000đ         → bước 10đ
 *   10,000–49,950đ    → bước 50đ
 *   >= 50,000đ        → bước 100đ
 *
 * HNX / UPCOM: tất cả → bước 100đ
 *
 * Biên độ giao động:
 *   HOSE: ±7%  | HNX: ±10%  | UPCOM: ±15%
 */

const TICK_TABLE = {
  HOSE: [
    { maxPrice: 9_999,    tick: 10  },
    { maxPrice: 49_950,   tick: 50  },
    { maxPrice: Infinity, tick: 100 },
  ],
  HNX:        [{ maxPrice: Infinity, tick: 100 }],
  UPCOM:      [{ maxPrice: Infinity, tick: 100 }],
  DERIVATIVE: [{ maxPrice: Infinity, tick: 100 }], // phái sinh dùng 0.1 điểm nhưng đơn giản hoá cho simulator
};

const PRICE_BAND_PCT = {
  HOSE:       0.07,
  HNX:        0.10,
  UPCOM:      0.15,
  DERIVATIVE: 0.10,
};

/**
 * Lấy bước giá (tick) cho một mức giá và sàn cụ thể.
 * @param {number} priceVnd - Giá VND
 * @param {string} exchange - HOSE | HNX | UPCOM | DERIVATIVE
 * @returns {number} bước giá (VND)
 */
export function getTickSize(priceVnd, exchange = 'HOSE') {
  const rules = TICK_TABLE[exchange] ?? TICK_TABLE.HOSE;
  const rule = rules.find(r => priceVnd <= r.maxPrice);
  return rule?.tick ?? 100;
}

/**
 * Làm tròn giá về bước giá hợp lệ gần nhất (round về bội số tick gần nhất).
 * @param {number} priceVnd
 * @param {string} exchange
 * @returns {number}
 */
export function snapToTickSize(priceVnd, exchange = 'HOSE') {
  const tick = getTickSize(priceVnd, exchange);
  return Math.round(priceVnd / tick) * tick;
}

/**
 * Kiểm tra giá có đúng bước giá không.
 * @param {number} priceVnd
 * @param {string} exchange
 * @returns {boolean}
 */
export function isValidTickSize(priceVnd, exchange = 'HOSE') {
  return priceVnd === snapToTickSize(priceVnd, exchange);
}

/**
 * Tính biên độ giao động (floor/ceil) theo giá tham chiếu và sàn.
 * @param {number} referenceVnd - Giá tham chiếu (giá đóng cửa hôm trước), VND
 * @param {string} exchange
 * @returns {{ floor: number, ceil: number, band_pct: number }}
 */
export function getPriceBand(referenceVnd, exchange = 'HOSE') {
  const pct = PRICE_BAND_PCT[exchange] ?? 0.07;
  const rawFloor = referenceVnd * (1 - pct);
  const rawCeil  = referenceVnd * (1 + pct);
  return {
    floor:    snapToTickSize(Math.ceil(rawFloor),  exchange),
    ceil:     snapToTickSize(Math.floor(rawCeil),  exchange),
    band_pct: pct,
    reference: referenceVnd,
  };
}

/**
 * Kiểm tra giá có trong biên độ giao động ngày không.
 * @returns {{ valid: boolean, floor: number, ceil: number, warning?: string }}
 */
export function validatePriceInBand(priceVnd, referenceVnd, exchange = 'HOSE') {
  if (!referenceVnd || referenceVnd <= 0) return { valid: true }; // không có giá TC → bỏ qua
  const { floor, ceil } = getPriceBand(referenceVnd, exchange);
  if (priceVnd < floor || priceVnd > ceil) {
    return {
      valid: false,
      floor,
      ceil,
      warning: `Giá ${priceVnd.toLocaleString('vi-VN')}đ nằm ngoài biên độ [${floor.toLocaleString('vi-VN')} – ${ceil.toLocaleString('vi-VN')}] hôm nay (TC: ${referenceVnd.toLocaleString('vi-VN')}đ)`,
    };
  }
  return { valid: true, floor, ceil };
}

/**
 * Kiểm tra symbol có phải phái sinh không (cho phép SHORT).
 * @param {string} symbol
 * @returns {boolean}
 */
export function isDerivativeSymbol(symbol) {
  return /^(VN30F|VN100F|VNXALLT)/i.test(symbol ?? '');
}

export default {
  getTickSize,
  snapToTickSize,
  isValidTickSize,
  getPriceBand,
  validatePriceInBand,
  isDerivativeSymbol,
};
