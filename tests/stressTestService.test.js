import { describe, it, expect } from 'vitest';
import { calculateStressTest } from '../services/ai/stressTestService.js';

describe('calculateStressTest', () => {
  it('tra ve cau truc dung: scenarios array', () => {
    const positions = [{ symbol: 'VCB', entry_price: 96000, quantity: 1000 }];

    const result = calculateStressTest({ positions });

    expect(result).toHaveProperty('scenarios');
    expect(Array.isArray(result.scenarios)).toBe(true);
  });

  it('default 3 scenarios: -10%, -15%, -20%', () => {
    const positions = [{ symbol: 'VCB', entry_price: 96000, quantity: 1000 }];

    const result = calculateStressTest({ positions });

    expect(result.scenarios).toHaveLength(3);
    expect(result.scenarios[0].dropPercent).toBe(-10);
    expect(result.scenarios[1].dropPercent).toBe(-15);
    expect(result.scenarios[2].dropPercent).toBe(-20);
  });

  it('moi scenario co dung fields', () => {
    const positions = [{ symbol: 'VCB', entry_price: 96000, quantity: 1000 }];

    const result = calculateStressTest({ positions });
    const scenario = result.scenarios[0];

    expect(scenario).toHaveProperty('dropPercent');
    expect(scenario).toHaveProperty('totalImpactVnd');
    expect(scenario).toHaveProperty('totalImpactPercent');
    expect(scenario).toHaveProperty('positions');
    expect(Array.isArray(scenario.positions)).toBe(true);
  });

  it('moi position trong scenario co dung fields', () => {
    const positions = [{ symbol: 'VCB', entry_price: 96000, quantity: 1000 }];

    const result = calculateStressTest({ positions });
    const posResult = result.scenarios[0].positions[0];

    expect(posResult).toHaveProperty('symbol');
    expect(posResult).toHaveProperty('sector');
    expect(posResult).toHaveProperty('beta');
    expect(posResult).toHaveProperty('positionValue');
    expect(posResult).toHaveProperty('impactVnd');
    expect(posResult).toHaveProperty('impactPercent');
  });

  it('BANKING beta = 1.2 cho VCB', () => {
    const positions = [{ symbol: 'VCB', entry_price: 100000, quantity: 1000 }];
    // positionValue = 100M
    // impact -10% scenario: 100M * 1.2 * 0.10 = 12M

    const result = calculateStressTest({ positions });
    const scenario = result.scenarios[0]; // -10%
    const posResult = scenario.positions[0];

    expect(posResult.symbol).toBe('VCB');
    expect(posResult.sector).toBe('BANKING');
    expect(posResult.beta).toBe(1.2);
    expect(posResult.positionValue).toBe(100000 * 1000);
    expect(posResult.impactVnd).toBeCloseTo(100000 * 1000 * 1.2 * 0.10, 0);
  });

  it('TECHNOLOGY beta = 0.8 cho FPT', () => {
    const positions = [{ symbol: 'FPT', entry_price: 120000, quantity: 500 }];
    // positionValue = 60M
    // impact -10%: 60M * 0.8 * 0.10 = 4.8M

    const result = calculateStressTest({ positions });
    const scenario = result.scenarios[0]; // -10%
    const posResult = scenario.positions[0];

    expect(posResult.sector).toBe('TECHNOLOGY');
    expect(posResult.beta).toBe(0.8);
    expect(posResult.impactVnd).toBeCloseTo(120000 * 500 * 0.8 * 0.10, 0);
  });

  it('OTHER sector beta = 1.0 cho symbol khong trong map', () => {
    const positions = [{ symbol: 'UNKNOWN', entry_price: 50000, quantity: 1000 }];

    const result = calculateStressTest({ positions });
    const posResult = result.scenarios[0].positions[0];

    expect(posResult.sector).toBe('OTHER');
    expect(posResult.beta).toBe(1.0);
  });

  it('totalImpactVnd = sum cua tat ca positions trong scenario', () => {
    const positions = [
      { symbol: 'VCB', entry_price: 100000, quantity: 1000 }, // BANKING 1.2
      { symbol: 'FPT', entry_price: 120000, quantity: 500 },  // TECH 0.8
    ];
    // -10% scenario:
    // VCB: 100M * 1.2 * 0.10 = 12M
    // FPT: 60M * 0.8 * 0.10 = 4.8M
    // total = 16.8M

    const result = calculateStressTest({ positions });
    const scenario = result.scenarios[0]; // -10%
    const expectedTotal = 100000 * 1000 * 1.2 * 0.10 + 120000 * 500 * 0.8 * 0.10;

    expect(scenario.totalImpactVnd).toBeCloseTo(expectedTotal, 0);
  });

  it('impact tang tuyen tinh voi scenario drop nhieu hon', () => {
    const positions = [{ symbol: 'VCB', entry_price: 100000, quantity: 1000 }];

    const result = calculateStressTest({ positions });
    const impact10 = result.scenarios[0].totalImpactVnd; // -10%
    const impact15 = result.scenarios[1].totalImpactVnd; // -15%
    const impact20 = result.scenarios[2].totalImpactVnd; // -20%

    expect(impact15).toBeGreaterThan(impact10);
    expect(impact20).toBeGreaterThan(impact15);
    // tuyen tinh: impact15 / impact10 ~ 1.5
    expect(impact15 / impact10).toBeCloseTo(1.5, 5);
    expect(impact20 / impact10).toBeCloseTo(2.0, 5);
  });

  it('custom scenario duoc them vao ket qua', () => {
    const positions = [{ symbol: 'VCB', entry_price: 100000, quantity: 1000 }];

    const result = calculateStressTest({ positions, customScenario: -25 });

    // 3 default + 1 custom = 4
    expect(result.scenarios).toHaveLength(4);
    const customScenario = result.scenarios.find(s => s.dropPercent === -25);
    expect(customScenario).toBeDefined();
    expect(customScenario.dropPercent).toBe(-25);
  });

  it('portfolio trong -> impact = 0', () => {
    const result = calculateStressTest({ positions: [] });

    for (const scenario of result.scenarios) {
      expect(scenario.totalImpactVnd).toBe(0);
      expect(scenario.positions).toHaveLength(0);
    }
  });

  it('SECTOR_BETAS coverage: REAL_ESTATE 1.5, STEEL 1.3, SECURITIES 1.4, ENERGY 0.9, CONSUMER 0.7, RETAIL 0.8', () => {
    const positions = [
      { symbol: 'VHM', entry_price: 50000, quantity: 100 },   // REAL_ESTATE 1.5
      { symbol: 'HPG', entry_price: 30000, quantity: 100 },   // STEEL 1.3
      { symbol: 'SSI', entry_price: 25000, quantity: 100 },   // SECURITIES 1.4
      { symbol: 'GAS', entry_price: 80000, quantity: 100 },   // ENERGY 0.9
      { symbol: 'VNM', entry_price: 70000, quantity: 100 },   // CONSUMER 0.7
      { symbol: 'MWG', entry_price: 60000, quantity: 100 },   // RETAIL 0.8
    ];

    const result = calculateStressTest({ positions });
    const posResults = result.scenarios[0].positions;

    const checkBeta = (sym, expectedBeta) => {
      const p = posResults.find(p => p.symbol === sym);
      expect(p, `${sym} should exist`).toBeDefined();
      expect(p.beta).toBe(expectedBeta);
    };

    checkBeta('VHM', 1.5);
    checkBeta('HPG', 1.3);
    checkBeta('SSI', 1.4);
    checkBeta('GAS', 0.9);
    checkBeta('VNM', 0.7);
    checkBeta('MWG', 0.8);
  });
});
