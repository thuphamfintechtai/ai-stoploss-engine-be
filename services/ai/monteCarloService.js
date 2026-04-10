/**
 * Monte Carlo Simulation Service — GBM 1000 paths voi price band clamping.
 *
 * Per D-05: GBM: dS = mu*S*dt + sigma*S*dW
 * Per D-06: 1000 paths, 20 trading days
 * Per D-07: Clamp HOSE +/-7%, HNX +/-10%
 * Per D-08: Output percentileBands (p5, p25, p50, p75, p95) + probabilityOfLoss + paths
 * Per D-09: Server-side, khong can Web Workers
 *
 * KHONG import database — tat ca input la parameters.
 */

import { mean, standardDeviation, quantile } from 'simple-statistics';

/**
 * Box-Muller transform: tao standard normal random variable tu 2 uniform randoms.
 *
 * @returns {number} Gia tri tuan theo N(0,1)
 */
function boxMullerRandom() {
  let u, v;
  do {
    u = Math.random();
  } while (u === 0); // Tranh log(0)
  do {
    v = Math.random();
  } while (v === 0);
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/**
 * Tinh daily returns tu mang OHLCV close prices.
 *
 * @param {Array<{close: number}>} ohlcv
 * @returns {number[]}
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
 * Chay Monte Carlo simulation voi GBM.
 *
 * @param {object} params
 * @param {Array<{symbol: string, entry_price: number, quantity: number}>} params.positions
 * @param {Record<string, Array<{close: number}>>} params.ohlcvBySymbol
 * @param {number} [params.numPaths=1000]
 * @param {number} [params.numDays=20]
 * @param {Record<string, string>} [params.exchangeBySymbol={}] - { VCB: 'HOSE', SHS: 'HNX' }
 * @returns {{
 *   percentileBands: { p5: number[], p25: number[], p50: number[], p75: number[], p95: number[] },
 *   probabilityOfLoss: number,
 *   paths: number[][],
 *   initialValue: number
 * }}
 */
export function runMonteCarloSimulation({
  positions = [],
  ohlcvBySymbol = {},
  numPaths = 1000,
  numDays = 20,
  exchangeBySymbol = {},
}) {
  const dt = 1; // 1 trading day

  // Tinh initial portfolio value
  const initialValue = positions.reduce(
    (sum, p) => sum + p.entry_price * p.quantity,
    0
  );

  if (positions.length === 0 || initialValue === 0) {
    const emptyBands = Array(numDays).fill(0);
    return {
      percentileBands: {
        p5: [...emptyBands], p25: [...emptyBands], p50: [...emptyBands],
        p75: [...emptyBands], p95: [...emptyBands],
      },
      probabilityOfLoss: 0,
      paths: Array(numPaths).fill(null).map(() => Array(numDays).fill(0)),
      initialValue: 0,
    };
  }

  // Tinh mu, sigma, va initial price cho moi symbol
  const symbolParams = {};
  for (const p of positions) {
    const ohlcv = ohlcvBySymbol[p.symbol];
    if (ohlcv && ohlcv.length >= 2) {
      const returns = getDailyReturns(ohlcv);
      const mu = returns.length > 0 ? mean(returns) : 0;
      const sigma = returns.length > 1 ? standardDeviation(returns) : 0.01;
      symbolParams[p.symbol] = { mu, sigma };
    } else {
      // Default values neu khong co OHLCV
      symbolParams[p.symbol] = { mu: 0, sigma: 0.01 };
    }
  }

  // Xac dinh max daily change theo exchange (price band clamping)
  function getMaxChange(symbol) {
    const exchange = exchangeBySymbol[symbol] || 'HOSE';
    return exchange === 'HNX' ? 0.10 : 0.07;
  }

  // Ma tran paths: paths[pathIdx][dayIdx] = portfolio value ngay do
  const allPaths = [];

  for (let pathIdx = 0; pathIdx < numPaths; pathIdx++) {
    // Khoi tao gia hien tai cua moi symbol = entry_price
    const currentPrices = {};
    for (const p of positions) {
      currentPrices[p.symbol] = p.entry_price;
    }

    const dailyValues = [];

    for (let day = 0; day < numDays; day++) {
      let portfolioValue = 0;

      for (const p of positions) {
        const { mu, sigma } = symbolParams[p.symbol];
        const maxChange = getMaxChange(p.symbol);

        // GBM: S_t+1 = S_t * exp((mu - sigma^2/2)*dt + sigma*sqrt(dt)*Z)
        const Z = boxMullerRandom();
        const drift = (mu - (sigma * sigma) / 2) * dt;
        const diffusion = sigma * Math.sqrt(dt) * Z;
        let dailyChange = Math.exp(drift + diffusion) - 1;

        // Clamp price band
        dailyChange = Math.max(-maxChange, Math.min(maxChange, dailyChange));

        // Update price
        currentPrices[p.symbol] = currentPrices[p.symbol] * (1 + dailyChange);

        portfolioValue += currentPrices[p.symbol] * p.quantity;
      }

      dailyValues.push(portfolioValue);
    }

    allPaths.push(dailyValues);
  }

  // Tinh percentile bands cho moi ngay
  const p5 = [];
  const p25 = [];
  const p50 = [];
  const p75 = [];
  const p95 = [];

  for (let day = 0; day < numDays; day++) {
    const valuesAtDay = allPaths.map(path => path[day]);
    p5.push(quantile(valuesAtDay, 0.05));
    p25.push(quantile(valuesAtDay, 0.25));
    p50.push(quantile(valuesAtDay, 0.50));
    p75.push(quantile(valuesAtDay, 0.75));
    p95.push(quantile(valuesAtDay, 0.95));
  }

  // Tinh probability of loss: ti le paths ma final value < initial value
  const finalValues = allPaths.map(path => path[numDays - 1]);
  const lossCount = finalValues.filter(v => v < initialValue).length;
  const probabilityOfLoss = lossCount / numPaths;

  return {
    percentileBands: { p5, p25, p50, p75, p95 },
    probabilityOfLoss,
    paths: allPaths,
    initialValue,
  };
}
