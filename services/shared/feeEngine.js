/**
 * Fee Engine — Tính phí giao dịch và thuế.
 *
 * Phí áp dụng:
 *   - Phí mua  = entryPrice × qty × buy_fee_percent
 *   - Phí bán  = closePrice × qty × sell_fee_percent
 *   - Thuế bán = closePrice × qty × sell_tax_percent
 *   - Net P&L  = gross_pnl - buy_fee - sell_fee - sell_tax
 *
 * Mặc định (nếu portfolio không config):
 *   buy_fee  = 0.15%
 *   sell_fee = 0.15%
 *   sell_tax = 0.10%
 */

const DEFAULT_BUY_FEE_PCT  = 0.0015; // 0.15%
const DEFAULT_SELL_FEE_PCT = 0.0015; // 0.15%
const DEFAULT_SELL_TAX_PCT = 0.0010; // 0.10%

/**
 * Tính phí giao dịch cho một position.
 *
 * MAP-05 D-06 LOCKED: input ép Math.round(Number(x)) ở đầu function — defense-in-depth
 * chống caller truyền float (parseFloat chain) hoặc string từ DB NUMERIC.
 *
 * @param {number|string} entryVnd   - Giá vào (VND)
 * @param {number|string} closeVnd   - Giá đóng (VND)
 * @param {number|string} qty        - Khối lượng (CP)
 * @param {object} [portfolio] - Portfolio config (buy_fee_percent, sell_fee_percent, sell_tax_percent)
 * @returns {{
 *   buy_fee_vnd: number,
 *   sell_fee_vnd: number,
 *   sell_tax_vnd: number,
 *   total_fee_vnd: number,
 *   gross_pnl_vnd: number,
 *   net_pnl_vnd: number
 * }}
 */
export function calculateFees(entryVnd, closeVnd, qty, portfolio = {}) {
  // Integer VND guards (MAP-05 D-06 scope): ép input về integer đầu function
  const entry = Math.round(Number(entryVnd));
  const close = Math.round(Number(closeVnd));
  const quantity = Math.round(Number(qty));

  const buyPct  = portfolio.buy_fee_percent  != null ? Number(portfolio.buy_fee_percent)  : DEFAULT_BUY_FEE_PCT;
  const sellPct = portfolio.sell_fee_percent != null ? Number(portfolio.sell_fee_percent) : DEFAULT_SELL_FEE_PCT;
  const taxPct  = portfolio.sell_tax_percent != null ? Number(portfolio.sell_tax_percent) : DEFAULT_SELL_TAX_PCT;

  const buyValue  = entry * quantity;
  const sellValue = close * quantity;

  const buy_fee_vnd  = Math.round(buyValue  * buyPct);
  const sell_fee_vnd = Math.round(sellValue * sellPct);
  const sell_tax_vnd = Math.round(sellValue * taxPct);
  const total_fee_vnd = buy_fee_vnd + sell_fee_vnd + sell_tax_vnd;

  // gross_pnl_vnd trên integer inputs → integer naturally
  const gross_pnl_vnd = (close - entry) * quantity;
  const net_pnl_vnd   = gross_pnl_vnd - total_fee_vnd;

  return {
    buy_fee_vnd,
    sell_fee_vnd,
    sell_tax_vnd,
    total_fee_vnd,
    gross_pnl_vnd,
    net_pnl_vnd,
  };
}

/**
 * Tính buy_fee khi mở position (lưu vào position record ngay khi tạo).
 * MAP-05 D-06: integer VND input guard.
 */
export function calculateBuyFee(entryVnd, qty, portfolio = {}) {
  const entry = Math.round(Number(entryVnd));
  const quantity = Math.round(Number(qty));
  const buyPct = portfolio.buy_fee_percent != null ? Number(portfolio.buy_fee_percent) : DEFAULT_BUY_FEE_PCT;
  return Math.round(entry * quantity * buyPct);
}

/**
 * Tính break-even price: giá cần bán tối thiểu để không lỗ (sau phí).
 * MAP-05 D-06: integer VND input guard. Math.ceil giữ nguyên semantics (round up).
 */
export function calculateBreakEven(entryVnd, qty, portfolio = {}) {
  const entry = Math.round(Number(entryVnd));
  const quantity = Math.round(Number(qty));

  const buyPct  = portfolio.buy_fee_percent  != null ? Number(portfolio.buy_fee_percent)  : DEFAULT_BUY_FEE_PCT;
  const sellPct = portfolio.sell_fee_percent != null ? Number(portfolio.sell_fee_percent) : DEFAULT_SELL_FEE_PCT;
  const taxPct  = portfolio.sell_tax_percent != null ? Number(portfolio.sell_tax_percent) : DEFAULT_SELL_TAX_PCT;

  const buyFee = entry * quantity * buyPct;
  // Phương trình: (breakEven - entry) * qty = buyFee + breakEven * qty * (sellPct + taxPct)
  // breakEven * qty * (1 - sellPct - taxPct) = entry * qty + buyFee
  const denominator = 1 - sellPct - taxPct;
  return Math.ceil((entry * quantity + buyFee) / quantity / denominator);
}

export default {
  calculateFees,
  calculateBuyFee,
  calculateBreakEven,
};
