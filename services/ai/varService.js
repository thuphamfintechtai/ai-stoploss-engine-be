/**
 * Historical Simulation VaR (Value at Risk) Service.
 *
 * Per D-01: Historical Simulation = sort daily returns, lay percentile (1 - confidenceLevel).
 * Per D-02: Dung simple-statistics percentile, mean, stddev.
 * Per D-03: Tra ve portfolioVaR + positionVaRs.
 * Per D-04: Kem summary sentence bang tieng Viet.
 *
 * KHONG import database — tat ca input la parameters.
 */

import { quantile, mean, standardDeviation } from 'simple-statistics';

/**
 * Tinh daily returns tu mang OHLCV (sort theo thu tu thoi gian, close prices).
 *
 * @param {Array<{close: number}>} ohlcv - Mang OHLCV, sort tang dan theo ngay
 * @returns {number[]} Mang daily returns
 */
function getDailyReturns(ohlcv) {
  const returns = [];
  for (let i = 1; i < ohlcv.length; i++) {
    const prev = ohlcv[i - 1].close;
    const curr = ohlcv[i].close;
    if (prev > 0) {
      returns.push((curr - prev) / prev);
    }
  }
  return returns;
}

/**
 * Tinh Historical VaR cho mot danh sach positions.
 *
 * @param {object} params
 * @param {Array<{symbol: string, entry_price: number, quantity: number, exchange?: string}>} params.positions
 * @param {Record<string, Array<{close: number}>>} params.ohlcvBySymbol - OHLCV data theo symbol
 * @param {number} [params.confidenceLevel=0.95] - Muc do tin cay (0-1)
 * @param {number} [params.lookbackDays=60] - So ngay lich su toi da
 * @returns {{
 *   portfolioVaR: { varVnd: number, varPercent: number, confidenceLevel: number },
 *   positionVaRs: Array<{ symbol: string, varVnd: number, varPercent: number }>,
 *   summary: string,
 *   warnings?: string[]
 * }}
 */
export function calculateHistoricalVaR({
  positions = [],
  ohlcvBySymbol = {},
  confidenceLevel = 0.95,
  lookbackDays = 60,
}) {
  // Portfolio trong
  if (!positions || positions.length === 0) {
    return {
      portfolioVaR: { varVnd: 0, varPercent: 0, confidenceLevel },
      positionVaRs: [],
      summary: `Với ${(confidenceLevel * 100).toFixed(0)}% tin cậy, max loss 1 ngày là 0 VND (0% portfolio)`,
      warnings: [],
    };
  }

  const warnings = [];
  const positionVaRs = [];

  // Tinh tong gia tri portfolio
  const totalPortfolioValue = positions.reduce(
    (sum, p) => sum + p.entry_price * p.quantity,
    0
  );

  // Tap hop portfolio daily returns (weighted)
  // Neu co du lieu cho tat ca symbols, tinh weighted portfolio returns
  let portfolioReturns = null;

  // Kiem tra tat ca symbols co OHLCV
  const symbolsWithData = positions.filter(p => ohlcvBySymbol[p.symbol]);

  if (symbolsWithData.length > 0) {
    // Tim so ngay minimum across all symbols
    let minLen = Infinity;
    for (const p of symbolsWithData) {
      const ohlcv = ohlcvBySymbol[p.symbol];
      const sliced = ohlcv.slice(-lookbackDays - 1);
      const returns = getDailyReturns(sliced);
      minLen = Math.min(minLen, returns.length);
    }

    if (minLen > 0) {
      portfolioReturns = Array(minLen).fill(0);

      for (const p of symbolsWithData) {
        const posValue = p.entry_price * p.quantity;
        const weight = posValue / totalPortfolioValue;

        const ohlcv = ohlcvBySymbol[p.symbol];
        const sliced = ohlcv.slice(-lookbackDays - 1);
        const returns = getDailyReturns(sliced);

        // Check data < 20 ngay
        if (returns.length < 20) {
          warnings.push(
            `${p.symbol}: chi co ${returns.length} ngay du lieu (khuyen nghi >= 20 ngay)`
          );
        }

        // Lay minLen returns cuoi cung (dong bo)
        const alignedReturns = returns.slice(-minLen);

        for (let i = 0; i < minLen; i++) {
          portfolioReturns[i] += weight * alignedReturns[i];
        }
      }
    }
  }

  // Portfolio VaR
  let portfolioVarPercent = 0;
  let portfolioVarVnd = 0;

  if (portfolioReturns && portfolioReturns.length > 0) {
    // Historical simulation: lay percentile (1 - confidenceLevel) -> con so am nhat (worst loss)
    const varReturn = quantile(portfolioReturns, 1 - confidenceLevel);
    // VaR la absolute value cua worst loss
    portfolioVarPercent = Math.abs(Math.min(varReturn, 0)) * 100;
    portfolioVarVnd = totalPortfolioValue * Math.abs(Math.min(varReturn, 0));
  }

  // Per-position VaR
  for (const p of positions) {
    const posValue = p.entry_price * p.quantity;
    let posVarPercent = 0;
    let posVarVnd = 0;

    if (ohlcvBySymbol[p.symbol]) {
      const ohlcv = ohlcvBySymbol[p.symbol];
      const sliced = ohlcv.slice(-lookbackDays - 1);
      const returns = getDailyReturns(sliced);

      if (returns.length > 0) {
        const varReturn = quantile(returns, 1 - confidenceLevel);
        posVarPercent = Math.abs(Math.min(varReturn, 0)) * 100;
        posVarVnd = posValue * Math.abs(Math.min(varReturn, 0));
      }
    }

    positionVaRs.push({
      symbol: p.symbol,
      varVnd: Math.round(posVarVnd),
      varPercent: parseFloat(posVarPercent.toFixed(4)),
    });
  }

  const varVndRounded = Math.round(portfolioVarVnd);
  const varPercentRounded = parseFloat(portfolioVarPercent.toFixed(4));
  const confidencePct = (confidenceLevel * 100).toFixed(0);
  const portfolioPercent = totalPortfolioValue > 0
    ? ((portfolioVarVnd / totalPortfolioValue) * 100).toFixed(2)
    : '0.00';

  const summary =
    `Với ${confidencePct}% tin cậy, max loss 1 ngày là ${varVndRounded.toLocaleString('vi-VN')} VND (${portfolioPercent}% portfolio)`;

  return {
    portfolioVaR: {
      varVnd: varVndRounded,
      varPercent: varPercentRounded,
      confidenceLevel,
    },
    positionVaRs,
    summary,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}
