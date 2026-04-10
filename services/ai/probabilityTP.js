/**
 * Probability-based Take Profit Service
 *
 * Tinh xac suat dat cac muc TP dua tren log-normal distribution.
 * Phan phoi log-normal phu hop voi bien dong gia co phieu trong ngan han.
 *
 * Cong thuc:
 *   Log returns: r_i = ln(close_i / close_{i-1})
 *   Scaling N ngay: mu_N = mu * N, sigma_N = sigma * sqrt(N)
 *   Target price: P_target = P_now * exp(mu_N + sigma_N * z)
 *   voi z = probit(1 - p) la quantile cua standard normal
 *
 * @experimental - Label experimental honest ve limitations cua model
 */
import { mean, standardDeviation, probit } from 'simple-statistics';

const MIN_DATA_DAYS = 60; // D-14: can >= 60 ngay du lieu

/**
 * Tinh xac suat dat cac muc Take Profit dua tren log-normal distribution.
 *
 * @param {Array<{close: number, [key: string]: any}>} ohlcvData - Mang OHLCV candles
 * @param {number} currentPrice - Gia hien tai (VND)
 * @param {number[]} timeframeDays - Cac timeframe can tinh (ngay)
 * @returns {{ levels: Array, data_quality: Object, experimental: true } | null}
 *   Tra ve null khi < 60 ngay du lieu (D-14 fallback signal)
 */
export function calculateTPProbabilities(
  ohlcvData,
  currentPrice,
  timeframeDays = [3, 5, 10, 20]
) {
  // Guard: can du du lieu
  if (!ohlcvData || ohlcvData.length < MIN_DATA_DAYS) {
    return null; // D-14: fallback to ATR x RR
  }

  // Lay mang closes, bo qua gia tri null/0
  const closes = ohlcvData
    .map(c => parseFloat(c.close))
    .filter(v => v != null && !isNaN(v) && v > 0);

  if (closes.length < MIN_DATA_DAYS) {
    return null;
  }

  // Tinh log returns: ln(close[i] / close[i-1])
  const logReturns = [];
  for (let i = 1; i < closes.length; i++) {
    logReturns.push(Math.log(closes[i] / closes[i - 1]));
  }

  if (logReturns.length < 2) {
    return null;
  }

  // Tinh thong ke daily
  const mu = mean(logReturns);
  const sigma = standardDeviation(logReturns);

  // Khi sigma = 0 (du lieu khong co bien dong) khong the tinh xac suat phan phoi
  // Dung nguong rat nho de tranh chia cho 0 trong probit
  if (sigma < 1e-10) {
    return null;
  }

  // Cac muc xac suat target (D-11: 25%, 50%, 75%, 90%)
  const percentileTargets = [0.25, 0.50, 0.75, 0.90];

  const allLevels = [];

  for (const days of timeframeDays) {
    // N-day scaling
    const muN = mu * days;
    const sigmaN = sigma * Math.sqrt(days);

    for (const pTarget of percentileTargets) {
      // z-score: probit(1 - pTarget) -> price vuot nguong nay voi xac suat pTarget
      const z = probit(1 - pTarget);
      const targetPrice = currentPrice * Math.exp(muN + sigmaN * z);

      // Chi lay cac muc TAKE PROFIT (price > currentPrice)
      if (targetPrice <= currentPrice) continue;

      const prob = Math.round(pTarget * 100); // % xac suat
      const price = Math.round(targetPrice); // Lam tron VND

      const label = `${prob}% dat ${price.toLocaleString('vi-VN')} trong ${days} ngay`;

      allLevels.push({
        price,
        probability: prob,
        timeframe_days: days,
        label
      });
    }
  }

  if (allLevels.length === 0) {
    return null;
  }

  // Sort by probability DESC, lay toi da 5 levels (D-11)
  const levels = allLevels
    .sort((a, b) => b.probability - a.probability)
    .slice(0, 5);

  // Dam bao it nhat 3 levels
  if (levels.length < 3) {
    return null;
  }

  return {
    levels,
    data_quality: {
      days_used: closes.length,
      mu_daily: mu,
      sigma_daily: sigma
    },
    experimental: true // D-13: label experimental
  };
}
