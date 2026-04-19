/**
 * Settlement E2E (MAP-02) — processSettlements transfer flow
 *
 * Mock-based E2E test: verify toan bo SQL flow khi co pending event den han:
 *   1. SELECT WHERE status='PENDING' AND settlement_date <= CURRENT_DATE
 *   2. Trong transaction: UPDATE portfolios (available_cash +=, pending_settlement_cash -=)
 *   3. UPDATE events status='SETTLED', settled_at=NOW()
 *   4. Return count cua events da xu ly
 *
 * KHONG goi real DB — day la unit mock test chung minh SQL patterns dung.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock database.js truoc khi import capitalService
// Khai bao bien chia se de test co the customize per-test
const dbMock = {
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  transaction: vi.fn().mockImplementation(async (callback) => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    };
    return callback(mockClient);
  }),
};

vi.mock('../../config/database.js', () => ({
  query: (...args) => dbMock.query(...args),
  transaction: (...args) => dbMock.transaction(...args),
  default: {},
}));

import CapitalService from '../../services/portfolio/capitalService.js';

describe('Settlement E2E — processSettlements transfer flow (MAP-02)', () => {
  beforeEach(() => {
    dbMock.query.mockReset();
    dbMock.transaction.mockReset();
    // Set default safe behavior
    dbMock.transaction.mockImplementation(async (callback) => {
      const mockClient = {
        query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      };
      return callback(mockClient);
    });
  });

  it('zero pending events → return 0, khong goi transaction', async () => {
    dbMock.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const count = await CapitalService.processSettlements();
    expect(count).toBe(0);
    expect(dbMock.transaction).not.toHaveBeenCalled();
  });

  it('1 pending event: SELECT → UPDATE portfolios (both cols) + UPDATE events SETTLED → count=1', async () => {
    const capturedSql = [];
    const capturedParams = [];

    // SELECT pending events
    dbMock.query.mockResolvedValueOnce({
      rows: [
        { id: 'evt-1', portfolio_id: 'port-1', amount: '5000000', settlement_date: '2026-04-19' },
      ],
      rowCount: 1,
    });

    // Transaction: capture all client.query calls
    dbMock.transaction.mockImplementationOnce(async (callback) => {
      const mockClient = {
        query: vi.fn().mockImplementation((sql, params) => {
          capturedSql.push(sql);
          capturedParams.push(params);
          return Promise.resolve({ rows: [], rowCount: 1 });
        }),
      };
      return callback(mockClient);
    });

    const count = await CapitalService.processSettlements();
    expect(count).toBe(1);
    expect(dbMock.transaction).toHaveBeenCalledTimes(1);

    // UPDATE financial.portfolios: available_cash += AND pending_settlement_cash -=
    const portfolioUpdate = capturedSql.find((s) => s.includes('UPDATE financial.portfolios'));
    expect(portfolioUpdate).toBeDefined();
    expect(portfolioUpdate).toMatch(/available_cash\s*=\s*available_cash\s*\+/);
    expect(portfolioUpdate).toMatch(/pending_settlement_cash\s*=\s*pending_settlement_cash\s*-/);

    // UPDATE financial.settlement_events: status='SETTLED' + settled_at=NOW()
    const eventUpdate = capturedSql.find((s) => s.includes('UPDATE financial.settlement_events'));
    expect(eventUpdate).toBeDefined();
    expect(eventUpdate).toMatch(/status\s*=\s*'SETTLED'/);
    expect(eventUpdate).toMatch(/settled_at\s*=\s*NOW\(\)/);

    // Params: portfolio update dung portfolio_id + amount
    const portfolioParamsIdx = capturedSql.indexOf(portfolioUpdate);
    expect(capturedParams[portfolioParamsIdx]).toEqual(['port-1', '5000000']);

    // Event update dung evt-1
    const eventParamsIdx = capturedSql.indexOf(eventUpdate);
    expect(capturedParams[eventParamsIdx]).toEqual(['evt-1']);
  });

  it('multiple pending events: process tuan tu, count match', async () => {
    dbMock.query.mockResolvedValueOnce({
      rows: [
        { id: 'evt-1', portfolio_id: 'port-1', amount: '5000000' },
        { id: 'evt-2', portfolio_id: 'port-2', amount: '3000000' },
        { id: 'evt-3', portfolio_id: 'port-1', amount: '2000000' },
      ],
      rowCount: 3,
    });
    dbMock.transaction.mockImplementation(async (callback) => {
      const mockClient = {
        query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
      };
      return callback(mockClient);
    });

    const count = await CapitalService.processSettlements();
    expect(count).toBe(3);
    expect(dbMock.transaction).toHaveBeenCalledTimes(3);
  });

  it('SELECT query filter dung: WHERE status=PENDING AND settlement_date <= CURRENT_DATE', async () => {
    dbMock.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await CapitalService.processSettlements();
    const selectSql = dbMock.query.mock.calls[0][0];
    expect(selectSql).toMatch(/SELECT.*FROM\s+financial\.settlement_events/i);
    expect(selectSql).toMatch(/status\s*=\s*'PENDING'/);
    expect(selectSql).toMatch(/settlement_date\s*<=\s*CURRENT_DATE/i);
  });
});
