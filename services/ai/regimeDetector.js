/**
 * Regime Detector — Rule-based market regime detection.
 *
 * Phan loai thi truong theo 4 che do: VOLATILE, BULLISH, BEARISH, SIDEWAYS.
 * Logic dua tren BB percentile va SMA crossover.
 *
 * Per D-03, D-04.
 */

/**
 * Multiplier ap dung cho stop loss theo che do thi truong.
 * @type {{ VOLATILE: number, BULLISH: number, BEARISH: number, SIDEWAYS: number }}
 */
export const REGIME_MULTIPLIERS = {
  VOLATILE: 2.5,
  BULLISH: 1.5,
  BEARISH: 1.5,
  SIDEWAYS: 1.0,
};

/**
 * Phat hien che do thi truong tu bo indicators.
 *
 * @param {{ bb: import('trading-signals').BollingerBands, sma50: import('trading-signals').SMA, sma200: import('trading-signals').SMA }} indicators
 * @returns {'VOLATILE' | 'BULLISH' | 'BEARISH' | 'SIDEWAYS'}
 */
export function detectRegime(indicators) {
  const { bb, sma50, sma200 } = indicators;

  // Neu BB chua on dinh, tra ve SIDEWAYS (default)
  if (!bb.isStable || !sma50.isStable) {
    return 'SIDEWAYS';
  }

  // Tinh BB percentile: do rong dai so voi gia giua
  const bbResult = bb.getResult();
  const bbPercentile = ((bbResult.upper - bbResult.lower) / bbResult.middle) * 100;

  if (bbPercentile > 70) {
    return 'VOLATILE';
  }

  // Dung SMA200 de xac dinh xu huong dai han
  if (sma200.isStable) {
    const sma50Value = Number(sma50.getResult());
    const sma200Value = Number(sma200.getResult());

    if (sma50Value > sma200Value) {
      return 'BULLISH';
    }
    if (sma50Value < sma200Value) {
      return 'BEARISH';
    }
  }

  return 'SIDEWAYS';
}
