/**
 * Slippage Calculator
 *
 * Tính slippage khi SL/TP trigger:
 *   - LONG SL: fill_price thường = MIN(candle.close, stop_loss)
 *     nếu candle.open <= stop_loss → gap down → fill tại candle.open
 *   - LONG TP: fill_price = MIN(candle.close, take_profit) khi giá pullback
 *     hoặc = take_profit nếu close vượt qua
 *
 * slippage_vnd (LONG SL):
 *   = (stop_loss - fill_price) × qty
 *   dương  → bất lợi (fill thấp hơn stop → gap)
 *   âm     → có lợi (fill cao hơn stop)
 *   = 0    → khớp đúng giá stop
 */

/**
 * Tính fill price và slippage khi Stop Loss trigger cho LONG.
 *
 * @param {object} candle   - { open, high, low, close }  (tất cả VND)
 * @param {number} stopLoss - Mức SL đặt (VND)
 * @param {number} qty      - Khối lượng
 * @returns {{ triggered: boolean, fill_price: number|null, slippage_vnd: number, slippage_reason: string }}
 */
export function calcLongSLSlippage(candle, stopLoss, qty) {
  if (candle.low > stopLoss) {
    return { triggered: false, fill_price: null, slippage_vnd: 0, slippage_reason: null };
  }

  let fill_price;
  let slippage_reason;

  if (candle.open <= stopLoss) {
    // Giá mở cửa đã dưới SL → gap down
    fill_price = candle.open;
    slippage_reason = 'GAP_DOWN';
  } else {
    // Nến đi xuống và chạm SL trong phiên
    // Nếu giá đóng nến trên SL (nến chạm rồi bounce) → fill tại SL
    // Nếu giá đóng nến dưới SL → fill tại close (sát thực tế hơn)
    fill_price = candle.close >= stopLoss ? stopLoss : candle.close;
    slippage_reason = fill_price < stopLoss ? 'NORMAL' : 'NORMAL';
  }

  const slippage_vnd = (stopLoss - fill_price) * qty; // dương = bất lợi

  return {
    triggered: true,
    fill_price,
    slippage_vnd,
    slippage_reason: slippage_vnd > 0 ? slippage_reason : 'FAVORABLE',
  };
}

/**
 * Tính fill price và slippage khi Stop Loss trigger cho SHORT.
 */
export function calcShortSLSlippage(candle, stopLoss, qty) {
  if (candle.high < stopLoss) {
    return { triggered: false, fill_price: null, slippage_vnd: 0, slippage_reason: null };
  }

  let fill_price;
  let slippage_reason;

  if (candle.open >= stopLoss) {
    fill_price = candle.open;
    slippage_reason = 'GAP_UP';
  } else {
    fill_price = candle.close <= stopLoss ? stopLoss : candle.close;
    slippage_reason = 'NORMAL';
  }

  const slippage_vnd = (fill_price - stopLoss) * qty; // dương = bất lợi (mua lại đắt hơn SL)

  return {
    triggered: true,
    fill_price,
    slippage_vnd,
    slippage_reason: slippage_vnd > 0 ? slippage_reason : 'FAVORABLE',
  };
}

/**
 * Tính fill price và slippage khi Take Profit trigger cho LONG.
 */
export function calcLongTPSlippage(candle, takeProfit, qty) {
  if (candle.high < takeProfit) {
    return { triggered: false, fill_price: null, slippage_vnd: 0, slippage_reason: null };
  }

  let fill_price;
  let slippage_reason;

  if (candle.open >= takeProfit) {
    // Gap up qua TP → fill tốt hơn kỳ vọng
    fill_price = candle.open;
    slippage_reason = 'FAVORABLE';
  } else if (candle.close >= takeProfit) {
    // Giá vượt TP và giữ trên TP → fill đúng tại TP (lệnh limit sell)
    fill_price = takeProfit;
    slippage_reason = 'NORMAL';
  } else {
    // Giá chạm TP rồi pullback về dưới → fill tại close (thực tế không kịp bán tại TP đỉnh)
    fill_price = candle.close;
    slippage_reason = 'PULLBACK_IN_CANDLE';
  }

  const slippage_vnd = (takeProfit - fill_price) * qty; // dương = bất lợi (fill thấp hơn TP)

  return {
    triggered: true,
    fill_price,
    slippage_vnd,
    slippage_reason: slippage_vnd > 0 ? slippage_reason : 'FAVORABLE',
  };
}

/**
 * Tính fill price và slippage khi Take Profit trigger cho SHORT.
 */
export function calcShortTPSlippage(candle, takeProfit, qty) {
  if (candle.low > takeProfit) {
    return { triggered: false, fill_price: null, slippage_vnd: 0, slippage_reason: null };
  }

  let fill_price;
  let slippage_reason;

  if (candle.open <= takeProfit) {
    fill_price = candle.open;
    slippage_reason = 'FAVORABLE';
  } else if (candle.close <= takeProfit) {
    fill_price = takeProfit;
    slippage_reason = 'NORMAL';
  } else {
    fill_price = candle.close;
    slippage_reason = 'PULLBACK_IN_CANDLE';
  }

  const slippage_vnd = (fill_price - takeProfit) * qty;

  return {
    triggered: true,
    fill_price,
    slippage_vnd,
    slippage_reason: slippage_vnd > 0 ? slippage_reason : 'FAVORABLE',
  };
}

/**
 * Quyết định SL hay TP thắng khi cả 2 đều trigger trong cùng 1 nến.
 * Logic: dựa vào giá open của nến để xác định điều gì xảy ra trước.
 *
 * @param {'LONG'|'SHORT'} side
 * @param {object} candle - { open, high, low, close }
 * @param {number} stopLoss
 * @param {number} takeProfit
 * @returns {'SL'|'TP'}
 */
export function resolveConflict(side, candle, stopLoss, takeProfit) {
  if (side === 'LONG') {
    if (candle.open <= stopLoss)   return 'SL'; // mở cửa đã dưới SL
    if (candle.open >= takeProfit) return 'TP'; // mở cửa đã trên TP
    // Open ở giữa: nến bearish → SL trước; bullish → TP trước
    return candle.close < candle.open ? 'SL' : 'TP';
  } else { // SHORT
    if (candle.open >= stopLoss)   return 'SL';
    if (candle.open <= takeProfit) return 'TP';
    return candle.close > candle.open ? 'SL' : 'TP';
  }
}

export default {
  calcLongSLSlippage,
  calcShortSLSlippage,
  calcLongTPSlippage,
  calcShortTPSlippage,
  resolveConflict,
};
