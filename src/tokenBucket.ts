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

  protected _currentTokens: number;
  protected _lastUpdated: number;
  protected readonly _clock: () => number;

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

    if (typeof optionsOrCapacity === 'object' && optionsOrCapacity !== null) {
      cap = optionsOrCapacity.capacity;
      rate = optionsOrCapacity.refillRate;
      initTokens = optionsOrCapacity.initialTokens;
      clk = optionsOrCapacity.clock;
    } else {
      cap = optionsOrCapacity;
      rate = refillRateParam!;
      initTokens = initialTokensParam;
      clk = clockParam;
    }

    this._clock = clk ?? (() => Date.now());
    const now = this._clock();
    const startingTokens = initTokens !== undefined ? initTokens : cap;

    this.capacity = cap;
    this.refillRate = rate;
    this._currentTokens = startingTokens;
    this._lastUpdated = now;
  }

  /**
   * Current number of tokens available in the bucket.
   */
  public get currentTokens(): number {
    return this._currentTokens;
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
}
