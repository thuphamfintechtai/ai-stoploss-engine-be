import { describe, it, expect } from 'vitest';
import { calculateSectorConcentration } from '../services/ai/sectorConcentration.js';

describe('calculateSectorConcentration', () => {
  it('tra ve cau truc dung', () => {
    const positions = [{ symbol: 'VCB', entry_price: 96000, quantity: 1000 }];

    const result = calculateSectorConcentration({ positions });

    expect(result).toHaveProperty('sectors');
    expect(result).toHaveProperty('warnings');
    expect(result).toHaveProperty('totalPortfolioValue');
    expect(Array.isArray(result.sectors)).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it('moi sector co dung fields', () => {
    const positions = [{ symbol: 'VCB', entry_price: 96000, quantity: 1000 }];

    const result = calculateSectorConcentration({ positions });
    const sector = result.sectors[0];

    expect(sector).toHaveProperty('sector');
    expect(sector).toHaveProperty('sectorLabel');
    expect(sector).toHaveProperty('totalValueVnd');
    expect(sector).toHaveProperty('percent');
    expect(sector).toHaveProperty('warningLevel');
  });

  it('100% BANKING (3 VCB positions) -> RED warning', () => {
    const positions = [
      { symbol: 'VCB', entry_price: 96000, quantity: 1000 },
      { symbol: 'TCB', entry_price: 30000, quantity: 2000 },
      { symbol: 'MBB', entry_price: 25000, quantity: 1000 },
    ];

    const result = calculateSectorConcentration({ positions });

    // Tat ca la BANKING -> 100%
    expect(result.sectors).toHaveLength(1);
    expect(result.sectors[0].sector).toBe('BANKING');
    expect(result.sectors[0].percent).toBeCloseTo(100, 2);
    expect(result.sectors[0].warningLevel).toBe('RED');

    // Co warning message
    const hasRedWarning = result.warnings.some(w => w.includes('qua tap trung'));
    expect(hasRedWarning).toBe(true);
  });

  it('2 sectors 50/50 -> YELLOW cho moi sector (30% < x <= 40% la YELLOW, 50% la RED)', () => {
    // 50% moi sector -> RED cho ca 2
    const positions = [
      { symbol: 'VCB', entry_price: 100000, quantity: 1000 },  // BANKING 100M
      { symbol: 'FPT', entry_price: 100000, quantity: 1000 },  // TECHNOLOGY 100M
    ];

    const result = calculateSectorConcentration({ positions });

    expect(result.sectors).toHaveLength(2);
    for (const s of result.sectors) {
      expect(s.percent).toBeCloseTo(50, 2);
      expect(s.warningLevel).toBe('RED'); // 50% > 40% -> RED
    }
  });

  it('sector khoang 35% -> YELLOW', () => {
    // BANKING 35%, TECHNOLOGY 35%, OTHER 30%
    // 100M BANKING, 100M TECH, 85.7M OTHER ~ 285.7M total
    // BANKING % = 100/285.7 = 35%
    const positions = [
      { symbol: 'VCB', entry_price: 100000, quantity: 1000 },   // BANKING 100M
      { symbol: 'FPT', entry_price: 100000, quantity: 1000 },   // TECHNOLOGY 100M
      { symbol: 'UNKNOWN1', entry_price: 50000, quantity: 1000 }, // OTHER 50M
      { symbol: 'UNKNOWN2', entry_price: 35714, quantity: 1000 }, // OTHER ~35.7M
    ];
    // Total = 285.714M, BANKING = 35%, TECH = 35%, OTHER = 30%
    // BANKING 35% > 30% -> YELLOW
    // TECH 35% > 30% -> YELLOW

    const result = calculateSectorConcentration({ positions });

    const banking = result.sectors.find(s => s.sector === 'BANKING');
    expect(banking).toBeDefined();
    expect(banking.warningLevel).toBe('YELLOW'); // 35% > 30% but <= 40%
  });

  it('sector < 30% -> GREEN', () => {
    // 5 sectors cung chia deu (20% moi sector)
    const positions = [
      { symbol: 'VCB', entry_price: 100000, quantity: 200 },   // BANKING 20M
      { symbol: 'FPT', entry_price: 100000, quantity: 200 },   // TECHNOLOGY 20M
      { symbol: 'HPG', entry_price: 100000, quantity: 200 },   // STEEL 20M
      { symbol: 'GAS', entry_price: 100000, quantity: 200 },   // ENERGY 20M
      { symbol: 'VNM', entry_price: 100000, quantity: 200 },   // CONSUMER 20M
    ];

    const result = calculateSectorConcentration({ positions });

    for (const s of result.sectors) {
      expect(s.percent).toBeCloseTo(20, 2);
      expect(s.warningLevel).toBe('GREEN'); // 20% < 30%
    }
    // Khong co warnings
    expect(result.warnings).toHaveLength(0);
  });

  it('portfolio trong -> sectors=[], warnings=[], totalPortfolioValue=0', () => {
    const result = calculateSectorConcentration({ positions: [] });

    expect(result.sectors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
    expect(result.totalPortfolioValue).toBe(0);
  });

  it('totalPortfolioValue = sum entry_price * quantity', () => {
    const positions = [
      { symbol: 'VCB', entry_price: 96000, quantity: 1000 }, // 96M
      { symbol: 'FPT', entry_price: 120000, quantity: 500 }, // 60M
    ];

    const result = calculateSectorConcentration({ positions });
    expect(result.totalPortfolioValue).toBe(96000 * 1000 + 120000 * 500);
  });

  it('sectors sort theo percent giam dan', () => {
    const positions = [
      { symbol: 'VCB', entry_price: 100000, quantity: 100 },  // BANKING 10M
      { symbol: 'FPT', entry_price: 100000, quantity: 300 },  // TECHNOLOGY 30M
      { symbol: 'GAS', entry_price: 100000, quantity: 200 },  // ENERGY 20M
    ];
    // TECH 50%, ENERGY 33%, BANKING 17%

    const result = calculateSectorConcentration({ positions });

    // First sector co percent cao nhat
    expect(result.sectors[0].percent).toBeGreaterThanOrEqual(result.sectors[1].percent);
    expect(result.sectors[1].percent).toBeGreaterThanOrEqual(result.sectors[2].percent);
  });

  it('sectorLabel tieng Viet dung voi getSector', () => {
    const positions = [{ symbol: 'VCB', entry_price: 96000, quantity: 1000 }];

    const result = calculateSectorConcentration({ positions });
    const banking = result.sectors.find(s => s.sector === 'BANKING');
    expect(banking).toBeDefined();
    // BANKING label la "Ngân hàng"
    expect(banking.sectorLabel).toBeTruthy();
    expect(typeof banking.sectorLabel).toBe('string');
  });

  it('warning message cho RED co "qua tap trung, can giam"', () => {
    const positions = [
      { symbol: 'VCB', entry_price: 100000, quantity: 1000 }, // BANKING 100%
    ];

    const result = calculateSectorConcentration({ positions });
    const redWarning = result.warnings.find(w => w.includes('qua tap trung'));
    expect(redWarning).toBeDefined();
  });

  it('warning message cho YELLOW co "can theo doi"', () => {
    // Tao YELLOW: 35% cho mot sector
    // 35M BANKING, 65M OTHER -> 35% BANKING
    const positions = [
      { symbol: 'VCB', entry_price: 35000, quantity: 1000 },    // BANKING 35M
      { symbol: 'UNKNOWN', entry_price: 65000, quantity: 1000 }, // OTHER 65M
    ];

    const result = calculateSectorConcentration({ positions });
    // BANKING = 35%: > 30% -> YELLOW
    const yellowWarning = result.warnings.find(w => w.includes('can theo doi'));
    expect(yellowWarning).toBeDefined();
  });

  it('group positions cung sector lai', () => {
    // 2 positions BANKING
    const positions = [
      { symbol: 'VCB', entry_price: 50000, quantity: 1000 }, // BANKING 50M
      { symbol: 'TCB', entry_price: 50000, quantity: 1000 }, // BANKING 50M
    ];

    const result = calculateSectorConcentration({ positions });

    // Chi co 1 sector BANKING
    expect(result.sectors).toHaveLength(1);
    expect(result.sectors[0].totalValueVnd).toBe(100000000); // 100M
    expect(result.sectors[0].percent).toBeCloseTo(100, 2);
  });

  it('value-based concentration (entry_price * qty), khong phai risk-based', () => {
    const positions = [{ symbol: 'VCB', entry_price: 96000, quantity: 1000 }];

    const result = calculateSectorConcentration({ positions });
    const banking = result.sectors.find(s => s.sector === 'BANKING');

    // totalValueVnd = entry_price * quantity
    expect(banking.totalValueVnd).toBe(96000 * 1000);
  });
});
