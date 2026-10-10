export interface TokenBucketOptions {
  /** Maximum burst capacity of the bucket */
  capacity: number;
  /** Number of tokens added to the bucket per second */
  refillRate: number;
  /** Initial number of tokens in the bucket (defaults to capacity) */
  initialTokens?: number;
  /** Custom clock returning current time in milliseconds (defaults to Date.now) */
  clock?: () => number;
}

/**
 * Production-grade Token Bucket rate limiter implementation.
 *
 * Implements the classic Token Bucket algorithm with dynamic time-based replenishment,
 * floating-point precision, burst handling, and zero background timer overhead.
 */
export class TokenBucket {
  public readonly capacity: number;
  public readonly refillRate: number;

  private _currentTokens: number;
  private _lastUpdated: number;
  private readonly _clock: () => number;

  constructor(options: TokenBucketOptions);
  constructor(
    capacity: number,
    refillRate: number,
    initialTokens?: number,
    clock?: () => number
  );
  constructor(
    optionsOrCapacity: TokenBucketOptions | number,
    refillRateParam?: number,
    initialTokensParam?: number,
    clockParam?: () => number
  ) {
    let cap: number;
    let rate: number;
    let initTokens: number | undefined;
    let clk: (() => number) | undefined;

    if (typeof optionsOrCapacity === 'number') {
      cap = optionsOrCapacity;
      rate = refillRateParam!;
      initTokens = initialTokensParam;
      clk = clockParam;
    } else {
      cap = optionsOrCapacity.capacity;
      rate = optionsOrCapacity.refillRate;
      initTokens = optionsOrCapacity.initialTokens;
      clk = optionsOrCapacity.clock;
    }

    if (typeof cap !== 'number' || isNaN(cap) || cap <= 0 || !isFinite(cap)) {
      throw new RangeError(`Capacity must be a positive finite number, received: ${cap}`);
    }

    if (typeof rate !== 'number' || isNaN(rate) || rate <= 0 || !isFinite(rate)) {
      throw new RangeError(`Refill rate must be a positive finite number, received: ${rate}`);
    }

    this._clock = clk ?? (() => Date.now());
    const now = this._clock();

    const startingTokens = initTokens !== undefined ? initTokens : cap;
    if (typeof startingTokens !== 'number' || isNaN(startingTokens) || startingTokens < 0) {
      throw new RangeError(
        `Initial tokens must be a non-negative number, received: ${startingTokens}`
      );
    }

    this.capacity = cap;
    this.refillRate = rate;
    this._currentTokens = Math.min(cap, startingTokens);
    this._lastUpdated = now;
  }

  /**
   * Current number of tokens available in the bucket, accounting for time elapsed.
   */
  public get currentTokens(): number {
    return this.getTokensRemaining();
  }

  /**
   * Timestamp (in milliseconds) of the last update/refill.
   */
  public get lastUpdated(): number {
    return this._lastUpdated;
  }

  /**
   * Alias for lastUpdated for compatibility.
   */
  public get lastUpdatedTimestamp(): number {
    return this._lastUpdated;
  }

  /**
   * Refills tokens based on the time elapsed since the last update.
   */
  public refill(): void {
    const now = this._clock();
    const elapsedMs = Math.max(0, now - this._lastUpdated);

    if (elapsedMs > 0) {
      const tokensToAdd = (elapsedMs / 1000) * this.refillRate;
      this._currentTokens = Math.min(this.capacity, this._currentTokens + tokensToAdd);
      this._lastUpdated = now;
    }
  }

  /**
   * Attempts to consume the specified number of tokens from the bucket.
   *
   * @param tokens Number of tokens to consume (defaults to 1). Must be non-negative.
   * @returns `true` if sufficient tokens were available and deducted; `false` otherwise.
   */
  public consume(tokens: number = 1): boolean {
    if (typeof tokens !== 'number' || isNaN(tokens)) {
      throw new TypeError(`Tokens to consume must be a valid number, received: ${tokens}`);
    }

    if (tokens < 0) {
      throw new RangeError(`Tokens to consume cannot be negative, received: ${tokens}`);
    }

    if (tokens === 0) {
      return true;
    }

    this.refill();

    if (this._currentTokens >= tokens) {
      this._currentTokens -= tokens;
      return true;
    }

    return false;
  }

  /**
   * Returns the current number of available tokens in the bucket after replenishment.
   */
  public getTokensRemaining(): number {
    this.refill();
    return this._currentTokens;
  }

  /**
   * Calculates the time in milliseconds until the required number of tokens will be available.
   *
   * @param requiredTokens The number of tokens needed (defaults to 1).
   * @returns Milliseconds until the tokens are available (0 if already available).
   */
  public getTimeUntilTokensAvailable(requiredTokens: number = 1): number {
    if (requiredTokens <= 0) {
      return 0;
    }

    const available = this.getTokensRemaining();
    if (available >= requiredTokens) {
      return 0;
    }

    const deficit = requiredTokens - available;
    const secondsNeeded = deficit / this.refillRate;
    return Math.ceil(secondsNeeded * 1000);
  }

  /**
   * Calculates the Unix timestamp (in seconds) when the specified number of tokens
   * will be available. Useful for X-RateLimit-Reset headers.
   *
   * @param requiredTokens The number of tokens needed (defaults to 1).
   * @returns Unix epoch timestamp in seconds.
   */
  public getResetTimestampInSeconds(requiredTokens: number = 1): number {
    const msUntilAvailable = this.getTimeUntilTokensAvailable(requiredTokens);
    const nowMs = this._clock();
    return Math.ceil((nowMs + msUntilAvailable) / 1000);
  }

  /**
   * Resets the bucket tokens back to full capacity.
   */
  public reset(): void {
    this._currentTokens = this.capacity;
    this._lastUpdated = this._clock();
  }
}
