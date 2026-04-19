/**
 * Tests cho CircuitBreaker state machine (MDI-09).
 *
 * Behavior reference: D-07 (05-CONTEXT.md)
 * - CLOSED → OPEN sau 3 failures trong windowMs (5 phút)
 * - OPEN → HALF_OPEN sau cooldownMs (10 phút)
 * - HALF_OPEN → CLOSED nếu probe success, OPEN nếu probe fail (reset cooldown)
 * - In-memory state, không persist
 *
 * Strategy: fake timers để control windowMs + cooldownMs chính xác.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  CircuitBreaker,
  BreakerOpenError,
  createBreaker,
} from '../../services/shared/circuitBreaker.js';

describe('CircuitBreaker — state machine (MDI-09)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-20T09:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('Test 1: CLOSED state — fn success → return value, failures count = 0', async () => {
    const breaker = createBreaker({ name: 'test' });
    const fn = vi.fn(async () => 'ok');

    const result = await breaker.execute(fn);

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(breaker.getState()).toBe('CLOSED');
    expect(breaker.getMetrics().failures).toBe(0);
  });

  it('Test 2: CLOSED state — fn throw → failures++', async () => {
    const breaker = createBreaker({ name: 'test' });
    const err = new Error('boom');
    const fn = vi.fn(async () => { throw err; });

    await expect(breaker.execute(fn)).rejects.toThrow('boom');

    expect(breaker.getState()).toBe('CLOSED');
    expect(breaker.getMetrics().failures).toBe(1);
  });

  it('Test 3: 3 consecutive failures trong windowMs → state = OPEN (từ failure thứ 3)', async () => {
    const breaker = createBreaker({
      name: 'test',
      failureThreshold: 3,
      windowMs: 5 * 60_000,
      cooldownMs: 10 * 60_000,
    });
    const fn = vi.fn(async () => { throw new Error('boom'); });

    await expect(breaker.execute(fn)).rejects.toThrow('boom');
    expect(breaker.getState()).toBe('CLOSED');

    await expect(breaker.execute(fn)).rejects.toThrow('boom');
    expect(breaker.getState()).toBe('CLOSED');

    await expect(breaker.execute(fn)).rejects.toThrow('boom');
    expect(breaker.getState()).toBe('OPEN');

    expect(breaker.getMetrics().failures).toBe(3);
  });

  it('Test 4: Failures ngoài windowMs không tích lũy (window-based counter reset)', async () => {
    const breaker = createBreaker({
      name: 'test',
      failureThreshold: 3,
      windowMs: 5 * 60_000,
      cooldownMs: 10 * 60_000,
    });
    const fn = vi.fn(async () => { throw new Error('boom'); });

    // Failure 1 tại t=0
    await expect(breaker.execute(fn)).rejects.toThrow('boom');
    // Failure 2 tại t=2 phút
    vi.advanceTimersByTime(2 * 60_000);
    await expect(breaker.execute(fn)).rejects.toThrow('boom');
    // Failure 3 tại t=6 phút → failure 1 ngoài window (5 phút) → chỉ còn 2 failures trong window
    vi.advanceTimersByTime(4 * 60_000);
    await expect(breaker.execute(fn)).rejects.toThrow('boom');

    expect(breaker.getState()).toBe('CLOSED');
    expect(breaker.getMetrics().failures).toBe(2);
  });

  it('Test 5: OPEN state — execute() throw BreakerOpenError ngay, không gọi fn', async () => {
    const breaker = createBreaker({ name: 'test', failureThreshold: 3 });
    const failFn = vi.fn(async () => { throw new Error('boom'); });

    // Đẩy state → OPEN
    await expect(breaker.execute(failFn)).rejects.toThrow('boom');
    await expect(breaker.execute(failFn)).rejects.toThrow('boom');
    await expect(breaker.execute(failFn)).rejects.toThrow('boom');
    expect(breaker.getState()).toBe('OPEN');

    // Call kế — không được gọi fn
    const probe = vi.fn(async () => 'should-not-run');
    await expect(breaker.execute(probe)).rejects.toThrow(BreakerOpenError);
    expect(probe).not.toHaveBeenCalled();

    // BreakerOpenError.code
    try {
      await breaker.execute(probe);
      throw new Error('expected BreakerOpenError');
    } catch (e) {
      expect(e).toBeInstanceOf(BreakerOpenError);
      expect(e.code).toBe('CIRCUIT_BREAKER_OPEN');
    }
  });

  it('Test 6: OPEN state sau cooldownMs → HALF_OPEN, cho phép 1 probe', async () => {
    const breaker = createBreaker({
      name: 'test',
      failureThreshold: 3,
      cooldownMs: 10 * 60_000,
    });
    const failFn = vi.fn(async () => { throw new Error('boom'); });

    await expect(breaker.execute(failFn)).rejects.toThrow('boom');
    await expect(breaker.execute(failFn)).rejects.toThrow('boom');
    await expect(breaker.execute(failFn)).rejects.toThrow('boom');
    expect(breaker.getState()).toBe('OPEN');

    // Advance cooldown
    vi.advanceTimersByTime(10 * 60_000 + 1);

    // Probe allowed — fn phải được gọi
    const probe = vi.fn(async () => 'recovered');
    const result = await breaker.execute(probe);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(result).toBe('recovered');
  });

  it('Test 7: HALF_OPEN probe success → CLOSED, failures = 0', async () => {
    const breaker = createBreaker({
      name: 'test',
      failureThreshold: 3,
      cooldownMs: 10 * 60_000,
    });
    const failFn = vi.fn(async () => { throw new Error('boom'); });

    await expect(breaker.execute(failFn)).rejects.toThrow('boom');
    await expect(breaker.execute(failFn)).rejects.toThrow('boom');
    await expect(breaker.execute(failFn)).rejects.toThrow('boom');
    expect(breaker.getState()).toBe('OPEN');

    vi.advanceTimersByTime(10 * 60_000 + 1);

    const probe = vi.fn(async () => 'recovered');
    const result = await breaker.execute(probe);

    expect(result).toBe('recovered');
    expect(breaker.getState()).toBe('CLOSED');
    expect(breaker.getMetrics().failures).toBe(0);
  });

  it('Test 8: HALF_OPEN probe fail → OPEN lại, reset cooldown timer', async () => {
    const breaker = createBreaker({
      name: 'test',
      failureThreshold: 3,
      cooldownMs: 10 * 60_000,
    });
    const failFn = vi.fn(async () => { throw new Error('boom'); });

    await expect(breaker.execute(failFn)).rejects.toThrow('boom');
    await expect(breaker.execute(failFn)).rejects.toThrow('boom');
    await expect(breaker.execute(failFn)).rejects.toThrow('boom');
    expect(breaker.getState()).toBe('OPEN');

    vi.advanceTimersByTime(10 * 60_000 + 1);

    // Probe fail → back to OPEN
    await expect(breaker.execute(failFn)).rejects.toThrow('boom');
    expect(breaker.getState()).toBe('OPEN');

    // Ngay sau khi probe fail, call nữa phải throw BreakerOpenError (cooldown reset)
    const anotherProbe = vi.fn(async () => 'should-not-run');
    await expect(breaker.execute(anotherProbe)).rejects.toThrow(BreakerOpenError);
    expect(anotherProbe).not.toHaveBeenCalled();

    // Nhưng nếu advance thêm cooldown → HALF_OPEN mở lại
    vi.advanceTimersByTime(10 * 60_000 + 1);
    const finalProbe = vi.fn(async () => 'ok');
    const res = await breaker.execute(finalProbe);
    expect(res).toBe('ok');
    expect(breaker.getState()).toBe('CLOSED');
  });

  it('Test 9: getMetrics() trả {state, failures, lastFailure, stateChanges}', async () => {
    const breaker = createBreaker({ name: 'test', failureThreshold: 3 });

    const m0 = breaker.getMetrics();
    expect(m0.state).toBe('CLOSED');
    expect(m0.failures).toBe(0);
    expect(m0.lastFailure).toBeNull();
    expect(m0.stateChanges).toBe(0);

    const failFn = vi.fn(async () => { throw new Error('boom'); });
    await expect(breaker.execute(failFn)).rejects.toThrow('boom');
    await expect(breaker.execute(failFn)).rejects.toThrow('boom');
    await expect(breaker.execute(failFn)).rejects.toThrow('boom');

    const m1 = breaker.getMetrics();
    expect(m1.state).toBe('OPEN');
    expect(m1.failures).toBe(3);
    expect(typeof m1.lastFailure).toBe('number');
    expect(m1.lastFailure).toBeLessThanOrEqual(Date.now());
    // CLOSED → OPEN = 1 state change
    expect(m1.stateChanges).toBeGreaterThanOrEqual(1);
  });

  it('CircuitBreaker class có thể được gọi trực tiếp (không chỉ factory)', async () => {
    const breaker = new CircuitBreaker({ name: 'direct' });
    const result = await breaker.execute(async () => 42);
    expect(result).toBe(42);
    expect(breaker.getState()).toBe('CLOSED');
  });

  it('BreakerOpenError extends Error với code=CIRCUIT_BREAKER_OPEN', () => {
    const err = new BreakerOpenError('test breaker');
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('CIRCUIT_BREAKER_OPEN');
    expect(err.message).toContain('test breaker');
  });
});
