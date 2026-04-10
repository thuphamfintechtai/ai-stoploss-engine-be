import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock aiService truoc khi import module chinh
vi.mock('../../services/aiService.js', () => ({
  callGeminiJSON: vi.fn(),
}));

import { generateRebalancingSuggestions } from '../../services/ai/rebalancingSuggestion.js';
import { callGeminiJSON } from '../../services/aiService.js';

// ── Mock positions ──────────────────────────────────────────────────────────

/**
 * 3 banking stocks (60%), 2 tech stocks (40%), total = 100_000_000 VND
 * VCB: 25_000_000, TCB: 20_000_000, MBB: 15_000_000 -> BANKING = 60%
 * FPT: 25_000_000, CMG: 15_000_000 -> TECHNOLOGY = 40%
 */
const mockPositions = [
  { symbol: 'VCB', market_value: 25_000_000, entry_price: 80000, quantity: 312 },
  { symbol: 'TCB', market_value: 20_000_000, entry_price: 30000, quantity: 666 },
  { symbol: 'MBB', market_value: 15_000_000, entry_price: 20000, quantity: 750 },
  { symbol: 'FPT', market_value: 25_000_000, entry_price: 100000, quantity: 250 },
  { symbol: 'CMG', market_value: 15_000_000, entry_price: 50000, quantity: 300 },
];

const TOTAL_VALUE = 100_000_000;

// ── Tests ───────────────────────────────────────────────────────────────────

describe('generateRebalancingSuggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('tra ve empty breakdown va no warnings khi positions rong', async () => {
    const result = await generateRebalancingSuggestions([], 0);

    expect(result).toHaveProperty('sectorBreakdown');
    expect(result).toHaveProperty('warnings');
    expect(result).toHaveProperty('suggestions');
    expect(result).toHaveProperty('narrative');
    expect(result.sectorBreakdown).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
    expect(result.suggestions).toHaveLength(0);
  });

  it('sectorBreakdown co 2 entries (BANKING va TECHNOLOGY)', async () => {
    callGeminiJSON.mockResolvedValue({ narrative: 'Mock Gemini narrative' });

    const result = await generateRebalancingSuggestions(mockPositions, TOTAL_VALUE);

    expect(result.sectorBreakdown).toHaveLength(2);

    const sectors = result.sectorBreakdown.map(s => s.sector);
    expect(sectors).toContain('BANKING');
    expect(sectors).toContain('TECHNOLOGY');
  });

  it('sectorBreakdown sorted by percent DESC', async () => {
    callGeminiJSON.mockResolvedValue({ narrative: 'OK' });

    const result = await generateRebalancingSuggestions(mockPositions, TOTAL_VALUE);

    // BANKING (60%) phai xuat hien truoc TECHNOLOGY (40%)
    expect(result.sectorBreakdown[0].sector).toBe('BANKING');
    expect(result.sectorBreakdown[1].sector).toBe('TECHNOLOGY');
  });

  it('sectorBreakdown co totalValue va percent chinh xac', async () => {
    callGeminiJSON.mockResolvedValue({ narrative: 'OK' });

    const result = await generateRebalancingSuggestions(mockPositions, TOTAL_VALUE);

    const banking = result.sectorBreakdown.find(s => s.sector === 'BANKING');
    expect(banking).toBeDefined();
    expect(banking.totalValue).toBe(60_000_000);
    expect(banking.percent).toBeCloseTo(60, 1);
    expect(banking.symbols).toContain('VCB');
    expect(banking.symbols).toContain('TCB');
    expect(banking.symbols).toContain('MBB');
    expect(banking.sectorLabel).toBe('Ngân hàng');
  });

  it('warnings co BANKING vi > 30%', async () => {
    callGeminiJSON.mockResolvedValue({ narrative: 'OK' });

    const result = await generateRebalancingSuggestions(mockPositions, TOTAL_VALUE);

    expect(result.warnings.length).toBeGreaterThan(0);
    const bankingWarning = result.warnings.find(w => w.sector === 'BANKING');
    expect(bankingWarning).toBeDefined();
    expect(bankingWarning.percent).toBeCloseTo(60, 1);
  });

  it('TECHNOLOGY (40%) cung tao warning', async () => {
    callGeminiJSON.mockResolvedValue({ narrative: 'OK' });

    const result = await generateRebalancingSuggestions(mockPositions, TOTAL_VALUE);

    const techWarning = result.warnings.find(w => w.sector === 'TECHNOLOGY');
    expect(techWarning).toBeDefined();
  });

  it('suggestions co text canh bao banking', async () => {
    callGeminiJSON.mockResolvedValue({ narrative: 'OK' });

    const result = await generateRebalancingSuggestions(mockPositions, TOTAL_VALUE);

    expect(result.suggestions.length).toBeGreaterThan(0);
    // It nhat 1 suggestion phai de cap den sector BANKING
    const hasBankingText = result.suggestions.some(
      s => s.includes('Ngân hàng') || s.includes('BANKING') || s.includes('VCB') || s.includes('TCB') || s.includes('MBB')
    );
    expect(hasBankingText).toBe(true);
  });

  it('suggestions chứa chuỗi "30%" hoặc "30"', async () => {
    callGeminiJSON.mockResolvedValue({ narrative: 'OK' });

    const result = await generateRebalancingSuggestions(mockPositions, TOTAL_VALUE);

    const has30 = result.suggestions.some(s => s.includes('30'));
    expect(has30).toBe(true);
  });

  it('narrative lay tu Gemini khi thanh cong', async () => {
    callGeminiJSON.mockResolvedValue({ narrative: 'Day la phan tich Gemini' });

    const result = await generateRebalancingSuggestions(mockPositions, TOTAL_VALUE);

    expect(result.narrative).toBe('Day la phan tich Gemini');
  });

  it('fallback narrative khi Gemini timeout (5s)', async () => {
    // Simulate timeout: Promise never resolves within 5s
    callGeminiJSON.mockImplementation(
      () => new Promise(resolve => setTimeout(() => resolve({ narrative: 'delayed' }), 10_000))
    );

    const result = await generateRebalancingSuggestions(mockPositions, TOTAL_VALUE);

    // Fallback narrative phai la string khong rong
    expect(typeof result.narrative).toBe('string');
    expect(result.narrative.length).toBeGreaterThan(0);
    // Fallback nen de cap den canh bao sector
    expect(result.narrative).toMatch(/Ngân hàng|BANKING|60|40/);
  }, 8000); // timeout test sau 8s (nen Gemini timeout 5s)

  it('skip positions khong co market_value va entry_price', async () => {
    callGeminiJSON.mockResolvedValue({ narrative: 'OK' });

    const positionsWithInvalid = [
      ...mockPositions,
      { symbol: 'VCB', market_value: null, entry_price: null, quantity: 100 },
      { symbol: 'HPG', market_value: undefined, entry_price: undefined, quantity: 50 },
    ];

    // Phai chay khong throw error
    const result = await generateRebalancingSuggestions(positionsWithInvalid, TOTAL_VALUE);
    expect(result.sectorBreakdown).toHaveLength(2);
  });

  it('xu ly positions chi co entry_price * quantity (khong co market_value)', async () => {
    callGeminiJSON.mockResolvedValue({ narrative: 'OK' });

    // Tao positions chi co entry_price * quantity (khong co market_value)
    const positionsNoMarketValue = [
      { symbol: 'VCB', entry_price: 80000, quantity: 312 },  // 24_960_000
      { symbol: 'FPT', entry_price: 100000, quantity: 250 }, // 25_000_000
    ];
    const total = 24_960_000 + 25_000_000;

    const result = await generateRebalancingSuggestions(positionsNoMarketValue, total);
    expect(result.sectorBreakdown).toHaveLength(2);

    const banking = result.sectorBreakdown.find(s => s.sector === 'BANKING');
    expect(banking).toBeDefined();
    expect(banking.totalValue).toBe(24_960_000);
  });
});
