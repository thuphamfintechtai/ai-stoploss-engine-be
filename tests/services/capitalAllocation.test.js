import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock database query truoc khi import service
vi.mock('../../config/database.js', () => ({
  query: vi.fn(),
}));

import { query } from '../../config/database.js';
import {
  calculateHalfKelly,
  getTradeStats,
  calculateRiskBudget,
} from '../../services/ai/capitalAllocation.js';

// ============================================================
// calculateHalfKelly
// ============================================================
describe('calculateHalfKelly', () => {
  it('winRate=0.6, avgWinLoss=2.0 -> halfKelly > 0, recommended_percent > 0, capped at 25', () => {
    // kelly = (0.6*2 - 0.4) / 2 = (1.2 - 0.4) / 2 = 0.4
    // halfKelly = 0.4 * 0.5 = 0.2
    // recommended_percent = min(0.2 * 100, 25) = 20
    const result = calculateHalfKelly(0.6, 2.0);
    expect(result.half_kelly).toBeGreaterThan(0);
    expect(result.recommended_percent).toBeGreaterThan(0);
    expect(result.recommended_percent).toBeLessThanOrEqual(25);
    expect(result.kelly_fraction).toBeCloseTo(0.4, 5);
    expect(result.half_kelly).toBeCloseTo(0.2, 5);
    expect(result.recommended_percent).toBeCloseTo(20, 5);
  });

  it('winRate=0.3, avgWinLoss=0.5 -> kelly <= 0, halfKelly = 0, interpretation contains Negative', () => {
    // kelly = (0.3*0.5 - 0.7) / 0.5 = (0.15 - 0.7) / 0.5 = -1.1
    const result = calculateHalfKelly(0.3, 0.5);
    expect(result.kelly_fraction).toBeLessThanOrEqual(0);
    expect(result.half_kelly).toBe(0);
    expect(result.recommended_percent).toBe(0);
    expect(result.interpretation).toContain('Negative');
  });

  it('winRate=0.5, avgWinLoss=1.0 -> kelly = 0, halfKelly = 0', () => {
    // kelly = (0.5*1.0 - 0.5) / 1.0 = 0
    const result = calculateHalfKelly(0.5, 1.0);
    expect(result.kelly_fraction).toBeCloseTo(0, 5);
    expect(result.half_kelly).toBe(0);
    expect(result.recommended_percent).toBe(0);
  });

  it('edge: winRate=0 -> halfKelly = 0', () => {
    const result = calculateHalfKelly(0, 2.0);
    expect(result.half_kelly).toBe(0);
    expect(result.recommended_percent).toBe(0);
  });

  it('edge: winRate=1 -> capped at 25%', () => {
    // kelly = (1*2 - 0) / 2 = 1.0 (100%)
    // halfKelly = 0.5 (50%)
    // recommended_percent = min(50, 25) = 25
    const result = calculateHalfKelly(1, 2.0);
    expect(result.recommended_percent).toBe(25);
    expect(result.half_kelly).toBeGreaterThan(0);
  });

  it('tra ve object voi dung cac fields', () => {
    const result = calculateHalfKelly(0.6, 2.0);
    expect(result).toHaveProperty('kelly_fraction');
    expect(result).toHaveProperty('half_kelly');
    expect(result).toHaveProperty('recommended_percent');
    expect(result).toHaveProperty('interpretation');
  });
});

// ============================================================
// getTradeStats
// ============================================================
describe('getTradeStats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('20 trades -> tra ve valid stats khong co warning', async () => {
    // Mock 20 closed trades: 12 wins (avgWin=5M), 8 losses (avgLoss=2.5M)
    query.mockResolvedValueOnce({
      rows: [
        {
          context: 'REAL',
          total_trades: '20',
          wins: '12',
          losses: '8',
          avg_win: '5000000',
          avg_loss: '2500000',
        },
      ],
    });

    const result = await getTradeStats('portfolio-uuid-123');
    expect(result.byContext.REAL).toBeDefined();
    expect(result.byContext.REAL.totalTrades).toBe(20);
    expect(result.byContext.REAL.wins).toBe(12);
    expect(result.byContext.REAL.losses).toBe(8);
    expect(result.byContext.REAL.winRate).toBeCloseTo(0.6, 5);
    expect(result.byContext.REAL.avgWinLoss).toBeCloseTo(2.0, 5);
    expect(result.warning).toBeUndefined();
    expect(result.combined).toBeDefined();
  });

  it('5 trades -> tra ve stats voi warning', async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          context: 'PAPER',
          total_trades: '5',
          wins: '3',
          losses: '2',
          avg_win: '3000000',
          avg_loss: '1500000',
        },
      ],
    });

    const result = await getTradeStats('portfolio-uuid-456');
    expect(result.combined.totalTrades).toBe(5);
    expect(result.warning).toBeDefined();
    expect(result.warning).toContain('10');
  });

  it('khong co trades -> tra ve empty stats voi warning', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    const result = await getTradeStats('portfolio-uuid-empty');
    expect(result.combined.totalTrades).toBe(0);
    expect(result.warning).toBeDefined();
  });

  it('co ca REAL va PAPER trades', async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          context: 'REAL',
          total_trades: '10',
          wins: '7',
          losses: '3',
          avg_win: '4000000',
          avg_loss: '2000000',
        },
        {
          context: 'PAPER',
          total_trades: '15',
          wins: '9',
          losses: '6',
          avg_win: '3000000',
          avg_loss: '1500000',
        },
      ],
    });

    const result = await getTradeStats('portfolio-uuid-both');
    expect(result.byContext.REAL).toBeDefined();
    expect(result.byContext.PAPER).toBeDefined();
    expect(result.combined.totalTrades).toBe(25);
  });
});

// ============================================================
// calculateRiskBudget
// ============================================================
describe('calculateRiskBudget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('tinh risk budget dung voi open positions', async () => {
    // Portfolio: 500M VND, maxRisk=5% -> maxRiskVnd = 25M
    // 1 LONG position VCB: entry=96000, stopLoss=94000, quantity=1000
    //   riskVnd = (96000 - 94000) * 1000 = 2,000,000
    query.mockResolvedValueOnce({
      rows: [
        {
          symbol: 'VCB',
          entry_price: '96000',
          stop_loss: '94000',
          quantity: '1000',
          side: 'LONG',
        },
      ],
    });

    const result = await calculateRiskBudget('portfolio-uuid-123', 500000000, 5);
    expect(result.maxRiskVnd).toBe(25000000);
    expect(result.usedRiskVnd).toBe(2000000);
    expect(result.usedRiskPercent).toBeCloseTo(8, 0); // 2M/25M * 100 = 8%
    expect(result.remainingBudget).toBe(23000000);
    expect(result.positions).toHaveLength(1);
    expect(result.positions[0].symbol).toBe('VCB');
    expect(result.positions[0].riskVnd).toBe(2000000);
    expect(result.sectorConcentration).toBeDefined();
  });

  it('khong co open positions -> usedRiskVnd = 0', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    const result = await calculateRiskBudget('portfolio-uuid-empty', 100000000, 5);
    expect(result.usedRiskVnd).toBe(0);
    expect(result.usedRiskPercent).toBe(0);
    expect(result.positions).toHaveLength(0);
    expect(result.sectorConcentration).toHaveLength(0);
  });

  it('default maxRiskPercent = 5 khi khong truyen', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    const result = await calculateRiskBudget('portfolio-uuid-123', 100000000);
    expect(result.maxRiskVnd).toBe(5000000); // 100M * 5%
  });

  it('tra ve sectorConcentration group by sector', async () => {
    // 2 positions cung sector BANKING
    query.mockResolvedValueOnce({
      rows: [
        { symbol: 'VCB', entry_price: '96000', stop_loss: '94000', quantity: '1000', side: 'LONG' },
        { symbol: 'TCB', entry_price: '30000', stop_loss: '28000', quantity: '2000', side: 'LONG' },
      ],
    });

    const result = await calculateRiskBudget('portfolio-uuid-banking', 500000000, 5);
    const bankingSector = result.sectorConcentration.find(s => s.sector === 'BANKING');
    expect(bankingSector).toBeDefined();
    // VCB: (96000-94000)*1000 = 2M, TCB: (30000-28000)*2000 = 4M -> total 6M
    expect(bankingSector.totalRiskVnd).toBe(6000000);
  });
});
