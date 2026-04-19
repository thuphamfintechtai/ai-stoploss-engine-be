import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock node-cron
vi.mock('node-cron', () => ({
  default: {
    schedule: vi.fn((pattern, callback) => {
      // Store callback for testing
      vi.fn.cronCallback = callback;
      return { stop: vi.fn() };
    }),
  },
}));

// Mock CapitalService cho worker scheduling tests
vi.mock('../../services/portfolio/capitalService.js', () => ({
  default: {
    processSettlements: vi.fn().mockResolvedValue(0),
  },
}));

import cron from 'node-cron';
import { startSettlementWorker } from '../../workers/settlementWorker.js';
import CapitalService from '../../services/portfolio/capitalService.js';

describe('startSettlementWorker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is exported as a function', () => {
    expect(typeof startSettlementWorker).toBe('function');
  });

  it('schedules cron job with pattern 0 9 * * 1-5 (Mon-Fri 9AM)', () => {
    startSettlementWorker();
    expect(cron.schedule).toHaveBeenCalledWith(
      '0 9 * * 1-5',
      expect.any(Function)
    );
  });

  it('calls CapitalService.processSettlements when cron fires', async () => {
    let capturedCallback;
    cron.schedule.mockImplementationOnce((pattern, callback) => {
      capturedCallback = callback;
      return { stop: vi.fn() };
    });

    startSettlementWorker();
    expect(capturedCallback).toBeDefined();

    await capturedCallback();
    expect(CapitalService.processSettlements).toHaveBeenCalledTimes(1);
  });

  it('handles errors from processSettlements without crashing', async () => {
    CapitalService.processSettlements.mockRejectedValueOnce(new Error('DB error'));

    let capturedCallback;
    cron.schedule.mockImplementationOnce((pattern, callback) => {
      capturedCallback = callback;
      return { stop: vi.fn() };
    });

    startSettlementWorker();
    // Should not throw
    await expect(capturedCallback()).resolves.not.toThrow();
  });
});

describe('Settlement E2E — T+2 transfer (MAP-02) — processSettlements SQL patterns', () => {
  it('source code processSettlements update dung cac column + status="SETTLED"', async () => {
    // Smoke: read capitalService source, verify SQL patterns cho processSettlements.
    // Day la kiem tra tinh chinh xac cua SQL string ma KHONG can integration DB.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const srcPath = path.resolve(here, '../../services/portfolio/capitalService.js');
    const source = fs.readFileSync(srcPath, 'utf8');

    // Extract processSettlements block bang cach tim tu dau ham den cuoi
    const start = source.indexOf('static async processSettlements');
    expect(start).toBeGreaterThan(-1);
    const end = source.indexOf('\n  }', start);
    const procBody = source.slice(start, end);

    // 1. SELECT pending events voi settlement_date <= CURRENT_DATE
    expect(procBody).toMatch(/SELECT.*FROM\s+financial\.settlement_events/i);
    expect(procBody).toMatch(/status\s*=\s*'PENDING'/);
    expect(procBody).toMatch(/settlement_date\s*<=\s*CURRENT_DATE/i);

    // 2. UPDATE portfolios: available_cash tang, pending_settlement_cash giam
    expect(procBody).toMatch(/UPDATE\s+financial\.portfolios/i);
    expect(procBody).toMatch(/available_cash\s*=\s*available_cash\s*\+/);
    expect(procBody).toMatch(/pending_settlement_cash\s*=\s*pending_settlement_cash\s*-/);

    // 3. UPDATE events: status='SETTLED' + settled_at=NOW()
    expect(procBody).toMatch(/UPDATE\s+financial\.settlement_events/i);
    expect(procBody).toMatch(/status\s*=\s*'SETTLED'/);
    expect(procBody).toMatch(/settled_at\s*=\s*NOW\(\)/);
  });

  it('settlementWorker wired trong index.js (import + call startup)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const idxPath = path.resolve(here, '../../index.js');
    const source = fs.readFileSync(idxPath, 'utf8');

    // Phai co ca import lan call
    const matches = source.match(/startSettlementWorker/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
    expect(source).toMatch(/import\s+\{[^}]*startSettlementWorker[^}]*\}\s+from/);
    expect(source).toMatch(/startSettlementWorker\s*\(\s*\)/);
  });
});

// E2E transfer flow test duoc dat o file rieng (settlement.e2e.test.js) vi
// mock 'capitalService' dau file nay conflict voi yeu cau import real service.
