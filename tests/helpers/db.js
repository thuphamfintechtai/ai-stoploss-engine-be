import { vi } from 'vitest';

// Mock query function -- returns { rows: [], rowCount: 0 } by default
export const mockQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });

// Mock transaction -- executes callback with mock client
export const mockTransaction = vi.fn().mockImplementation(async (callback) => {
  const mockClient = {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  };
  return callback(mockClient);
});

// Helper to setup mock module for config/database.js
export function setupDbMock() {
  vi.mock('../../config/database.js', () => ({
    query: mockQuery,
    transaction: mockTransaction,
    default: {},
  }));
}

// Reset all mocks between tests
export function resetDbMocks() {
  mockQuery.mockClear();
  mockTransaction.mockClear();
}
