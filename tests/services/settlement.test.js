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

// Mock CapitalService
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
