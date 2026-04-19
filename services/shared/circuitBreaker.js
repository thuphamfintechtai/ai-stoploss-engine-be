/**
 * CircuitBreaker — MDI-09 (D-07)
 *
 * State machine wrap các upstream call (VPBS) để không cascade fail khi upstream down.
 *
 * States:
 *   - CLOSED:     Hoạt động bình thường. Fail tích lũy trong window trượt windowMs.
 *                 Khi failures.length >= failureThreshold → chuyển OPEN.
 *   - OPEN:       Fail fast — throw BreakerOpenError ngay, không gọi fn.
 *                 Sau cooldownMs → tự chuyển HALF_OPEN ở lần execute() kế tiếp.
 *   - HALF_OPEN:  Cho phép 1 probe call. Success → CLOSED (clear failures).
 *                 Fail → OPEN lại + reset cooldown.
 *
 * State được giữ in-memory (per-process). F0 acceptable — không persist.
 *
 * Log format khi đổi state:
 *   [CB:<name>] state=<new> from=<old> failures=<n>
 *
 * Threat mitigated: T-05-10 (DoS cascade khi VPBS down).
 */

/**
 * Error thrown khi breaker ở state OPEN (fail-fast, không gọi upstream).
 */
export class BreakerOpenError extends Error {
  constructor(nameOrMessage = 'circuit breaker open') {
    super(
      nameOrMessage && nameOrMessage.includes('open')
        ? nameOrMessage
        : `Circuit breaker open for "${nameOrMessage}"`
    );
    this.name = 'BreakerOpenError';
    this.code = 'CIRCUIT_BREAKER_OPEN';
  }
}

const DEFAULTS = {
  failureThreshold: 3,
  windowMs: 5 * 60_000,      // 5 phút
  cooldownMs: 10 * 60_000,   // 10 phút
};

export class CircuitBreaker {
  /**
   * @param {object} opts
   * @param {string} [opts.name='default']       — tên breaker (dùng cho log)
   * @param {number} [opts.failureThreshold=3]   — số failures trong window → OPEN
   * @param {number} [opts.windowMs=300000]      — cửa sổ trượt đếm failures (5 phút)
   * @param {number} [opts.cooldownMs=600000]    — thời gian OPEN → HALF_OPEN (10 phút)
   */
  constructor(opts = {}) {
    this.name = opts.name || 'default';
    this.failureThreshold = opts.failureThreshold ?? DEFAULTS.failureThreshold;
    this.windowMs = opts.windowMs ?? DEFAULTS.windowMs;
    this.cooldownMs = opts.cooldownMs ?? DEFAULTS.cooldownMs;

    this.state = 'CLOSED';
    /** @type {number[]} timestamps (ms) của failures gần đây */
    this._failures = [];
    this._openedAt = null;
    this._stateChanges = 0;
  }

  /** Public: state hiện tại ('CLOSED' | 'OPEN' | 'HALF_OPEN'). */
  getState() {
    return this.state;
  }

  /**
   * Snapshot metrics cho observability / log.
   * @returns {{ state: string, failures: number, lastFailure: number|null, stateChanges: number, name: string }}
   */
  getMetrics() {
    const lastFailure = this._failures.length
      ? this._failures[this._failures.length - 1]
      : null;
    return {
      name: this.name,
      state: this.state,
      failures: this._failures.length,
      lastFailure,
      stateChanges: this._stateChanges,
    };
  }

  /**
   * Chạy `fn` qua breaker.
   * - CLOSED: gọi fn, prune failures ngoài window, push timestamp nếu fail;
   *           failures >= threshold → OPEN.
   * - OPEN:   throw BreakerOpenError (nếu còn trong cooldown). Nếu cooldown hết
   *           → chuyển HALF_OPEN và thử probe.
   * - HALF_OPEN: cho phép 1 call. Success → CLOSED. Fail → OPEN lại.
   *
   * @template T
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  async execute(fn) {
    // Lazy auto-transition OPEN → HALF_OPEN khi cooldown hết hạn.
    if (this.state === 'OPEN' && this._openedAt != null) {
      const elapsed = Date.now() - this._openedAt;
      if (elapsed >= this.cooldownMs) {
        this._transition('HALF_OPEN');
      }
    }

    if (this.state === 'OPEN') {
      throw new BreakerOpenError(this.name);
    }

    if (this.state === 'HALF_OPEN') {
      try {
        const result = await fn();
        // Probe success → CLOSED, clear failures
        this._failures = [];
        this._openedAt = null;
        this._transition('CLOSED');
        return result;
      } catch (err) {
        // Probe fail → OPEN lại, reset cooldown timer
        this._openedAt = Date.now();
        this._transition('OPEN');
        throw err;
      }
    }

    // state === 'CLOSED'
    try {
      const result = await fn();
      return result;
    } catch (err) {
      this._recordFailureCLOSED();
      throw err;
    }
  }

  // --- internal ---

  _recordFailureCLOSED() {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    // prune stale failures
    this._failures = this._failures.filter((ts) => ts >= windowStart);
    this._failures.push(now);
    if (this._failures.length >= this.failureThreshold) {
      this._openedAt = now;
      this._transition('OPEN');
    }
  }

  _transition(next) {
    if (this.state === next) return;
    const prev = this.state;
    this.state = next;
    this._stateChanges += 1;
    // stderr-free log: upstream metrics/ops có thể tail.
    console.log(
      `[CB:${this.name}] state=${next} from=${prev} failures=${this._failures.length}`
    );
  }
}

/**
 * Factory helper — tương đương `new CircuitBreaker(opts)`.
 * @param {object} opts
 * @returns {CircuitBreaker}
 */
export function createBreaker(opts = {}) {
  return new CircuitBreaker(opts);
}

export default { CircuitBreaker, BreakerOpenError, createBreaker };
