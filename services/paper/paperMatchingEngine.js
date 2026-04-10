/**
 * Paper Matching Engine — Mô phỏng khớp lệnh paper trading.
 *
 * Slippage formula (D-02):
 *   slippagePct = base_spread * (1 + volumeImpact)
 *   volumeImpact = quantity / max(avgDailyVolume, 1)
 *
 * Liquidity tiers:
 *   HIGH  (avgDailyVolume > 1M)   → base_spread = 0.001
 *   MEDIUM (100K < vol <= 1M)     → base_spread = 0.002
 *   LOW   (vol <= 100K)           → base_spread = 0.003
 *
 * Fill probability (D-03) dua tren volume ratio cho LO orders:
 *   ratio = orderQty / avgDailyVolume
 *   < 0.001 → 0.95 | < 0.01 → 0.80 | < 0.05 → 0.50 | < 0.10 → 0.25 | else 0.10
 *
 * KHONG import slippageCalculator.js (do la SL/TP slippage, khac voi order fill slippage)
 */

import { snapToTickSize, validatePriceInBand } from '../shared/tickSizeEngine.js';

class PaperMatchingEngine {
  /**
   * Tinh slippage (VND) cho MP order dua tren liquidity tier va volume impact.
   * @param {number} price - Gia hien tai (VND)
   * @param {number} quantity - So luong co phieu
   * @param {number} avgDailyVolume - Khoi luong giao dich trung binh ngay
   * @param {string} exchange - HOSE | HNX | UPCOM
   * @returns {number} Slippage (VND), so nguyen >= 0
   */
  static calculateSlippage(price, quantity, avgDailyVolume, exchange = 'HOSE') {
    // Xac dinh liquidity tier va base spread
    let baseSpread;
    if (avgDailyVolume > 1_000_000) {
      baseSpread = 0.001; // HIGH
    } else if (avgDailyVolume > 100_000) {
      baseSpread = 0.002; // MEDIUM
    } else {
      baseSpread = 0.003; // LOW
    }

    const volumeImpact = quantity / Math.max(avgDailyVolume, 1);
    const slippagePct = baseSpread * (1 + volumeImpact);

    return Math.round(price * slippagePct);
  }

  /**
   * Tinh xac suat fill cho LO order dua tren ratio khoi luong.
   * @param {number} orderQty - Khoi luong dat
   * @param {number} avgDailyVolume - Khoi luong giao dich trung binh ngay
   * @returns {number} Xac suat fill tu 0.10 den 0.95
   */
  static calculateFillProbability(orderQty, avgDailyVolume) {
    const ratio = orderQty / Math.max(avgDailyVolume, 1);

    if (ratio < 0.001) return 0.95;
    if (ratio < 0.01)  return 0.80;
    if (ratio < 0.05)  return 0.50;
    if (ratio < 0.10)  return 0.25;
    return 0.10;
  }

  /**
   * Thu fill lenh Limit Order (LO).
   * BUY fill khi currentPrice <= limit_price.
   * SELL fill khi currentPrice >= limit_price.
   * Co kiem tra fill probability (volume ratio).
   *
   * @param {object} order - { side: 'BUY'|'SELL', limit_price: number, quantity: number }
   * @param {number} currentPrice - Gia hien tai (VND)
   * @param {number} avgDailyVolume - Khoi luong giao dich trung binh ngay
   * @returns {{ filled: boolean, fillPrice?: number, slippage?: number, reason?: string }}
   */
  static tryFillLimitOrder(order, currentPrice, avgDailyVolume) {
    // Kiem tra dieu kien gia cross
    const priceCrossed = order.side === 'BUY'
      ? currentPrice <= order.limit_price
      : currentPrice >= order.limit_price;

    if (!priceCrossed) {
      return { filled: false };
    }

    // Kiem tra fill probability
    const fillProb = PaperMatchingEngine.calculateFillProbability(order.quantity, avgDailyVolume);
    if (Math.random() > fillProb) {
      return { filled: false, reason: 'LOW_FILL_PROBABILITY' };
    }

    // LO fill tai limit price (khong slippage)
    return {
      filled: true,
      fillPrice: order.limit_price,
      slippage: 0,
    };
  }

  /**
   * Fill lenh Market Order (MP) voi slippage.
   * BUY: fillPrice = currentPrice + slippage
   * SELL: fillPrice = currentPrice - slippage
   * Snap to tick size va clamp within price band.
   *
   * @param {object} order - { side: 'BUY'|'SELL', quantity: number, reference_price?: number }
   * @param {number} currentPrice - Gia hien tai (VND)
   * @param {number} avgDailyVolume - Khoi luong giao dich trung binh ngay
   * @param {string} exchange - HOSE | HNX | UPCOM
   * @returns {{ filled: boolean, fillPrice: number, slippage: number }}
   */
  static fillMarketOrder(order, currentPrice, avgDailyVolume, exchange = 'HOSE') {
    const slippage = PaperMatchingEngine.calculateSlippage(
      currentPrice,
      order.quantity,
      avgDailyVolume,
      exchange
    );

    let rawFillPrice;
    if (order.side === 'BUY') {
      rawFillPrice = currentPrice + slippage;
    } else {
      rawFillPrice = currentPrice - slippage;
    }

    // Snap to tick size
    let fillPrice = snapToTickSize(rawFillPrice, exchange);

    // Clamp within price band (per Pitfall 3 - tranh vuot bien do gia san)
    const refPrice = order.reference_price || currentPrice;
    const bandResult = validatePriceInBand(fillPrice, refPrice, exchange);
    if (!bandResult.valid) {
      // Clamp vao bien do hop le
      if (order.side === 'BUY' && bandResult.ceil) {
        fillPrice = snapToTickSize(bandResult.ceil, exchange);
      } else if (order.side === 'SELL' && bandResult.floor) {
        fillPrice = snapToTickSize(bandResult.floor, exchange);
      }
    }

    const actualSlippage = Math.abs(fillPrice - currentPrice);

    return {
      filled: true,
      fillPrice,
      slippage: actualSlippage,
    };
  }

  /**
   * Fill lenh ATO (At The Open) tai gia mo cua.
   * @param {object} order - Order object
   * @param {number} openPrice - Gia mo cua phien (VND)
   * @returns {{ filled: boolean, fillPrice: number, slippage: number }}
   */
  static fillATOOrder(order, openPrice) {
    return {
      filled: true,
      fillPrice: openPrice,
      slippage: 0,
    };
  }

  /**
   * Fill lenh ATC (At The Close) tai gia dong cua.
   * @param {object} order - Order object
   * @param {number} closePrice - Gia dong cua phien (VND)
   * @returns {{ filled: boolean, fillPrice: number, slippage: number }}
   */
  static fillATCOrder(order, closePrice) {
    return {
      filled: true,
      fillPrice: closePrice,
      slippage: 0,
    };
  }
}

export default PaperMatchingEngine;
