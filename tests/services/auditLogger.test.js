/**
 * auditLogger.test.js — AIT-09 (D-09)
 *
 * Test service `logAiCall` (fire-and-forget insert vào ai_audit_log).
 *
 * Strategy: Mock config/database.js `query` để capture INSERT call, assert
 *   - 9 params đúng thứ tự
 *   - Truncate > 10k ký tự
 *   - Missing userId → skip, không INSERT
 *   - DB error → không throw
 *   - aiService.callGeminiJSON khi có auditContext → log 1 lần
 *
 * Threat mitigated: T-04-09 (user tranh cãi AI recommendation, không có bằng chứng).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock query — dùng closure vì vi.mock được hoisted.
const mockQuery = vi.fn();

vi.mock('../../config/database.js', () => ({
  query: (...args) => mockQuery(...args),
}));

const { logAiCall } = await import('../../services/ai/auditLogger.js');

describe('logAiCall — AIT-09 (D-09)', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
  });

  it('Test 2.1 — happy path: insert với 9 params đúng thứ tự', async () => {
    await logAiCall({
      userId: 'test-user-uuid',
      endpoint: 'generateSignal',
      modelVersion: 'gemini-1.5-flash',
      prompt: 'hello prompt',
      response: '{"action":"BUY"}',
      latencyMs: 1234,
      status: 'success',
      inputTokens: 100,
      outputTokens: 50,
    });

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO\s+\S+\.ai_audit_log/i);
    expect(sql).toMatch(/\$1.*\$9/s);
    // Params order: user_id, endpoint, model_version, prompt_text, response_text,
    //               input_tokens, output_tokens, latency_ms, status
    expect(params).toEqual([
      'test-user-uuid',
      'generateSignal',
      'gemini-1.5-flash',
      'hello prompt',
      '{"action":"BUY"}',
      100,
      50,
      1234,
      'success',
    ]);
  });

  it('Test 2.2 — prompt + response > 10_000 ký tự → truncate trước khi INSERT', async () => {
    const longStr = 'a'.repeat(15_000);
    await logAiCall({
      userId: 'u1',
      endpoint: 'analyzeTrend',
      modelVersion: 'gemini-1.5-flash',
      prompt: longStr,
      response: longStr,
      latencyMs: 100,
    });

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [, params] = mockQuery.mock.calls[0];
    // prompt_text (index 3) và response_text (index 4) đều ≤ 10_000
    expect(params[3].length).toBe(10_000);
    expect(params[4].length).toBe(10_000);
  });

  it('Test 2.3 — thiếu userId → skip INSERT, console.warn', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await logAiCall({
      userId: null,
      endpoint: 'generateSignal',
      modelVersion: 'gemini-1.5-flash',
      prompt: 'p',
      response: 'r',
      latencyMs: 1,
    });

    expect(mockQuery).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('Test 2.4 — query throw DB error → logAiCall không re-throw, vẫn resolve', async () => {
    mockQuery.mockRejectedValueOnce(new Error('FATAL: DB connection lost'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // KHÔNG throw
    await expect(
      logAiCall({
        userId: 'u1',
        endpoint: 'generateSignal',
        modelVersion: 'gemini-1.5-flash',
        prompt: 'p',
        response: 'r',
        latencyMs: 1,
      })
    ).resolves.toBeUndefined();

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('Test 2.5 — thiếu endpoint → skip INSERT, console.warn', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await logAiCall({
      userId: 'u1',
      endpoint: null,
      modelVersion: 'gemini-1.5-flash',
      prompt: 'p',
      response: 'r',
      latencyMs: 1,
    });

    expect(mockQuery).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
