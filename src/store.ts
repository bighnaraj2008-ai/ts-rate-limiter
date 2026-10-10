import { TokenBucket } from './tokenBucket';

/**
 * Interface representing a store for TokenBucket instances keyed by identifier.
 */
export interface TokenBucketStore {
  /** Get a bucket by key */
  get(key: string): TokenBucket | undefined;
  /** Save or update a bucket by key */
  set(key: string, bucket: TokenBucket): void;
  /** Check if a key exists */
  has(key: string): boolean;
  /** Delete a bucket by key */
  delete(key: string): boolean;
  /** Clear all buckets */
  clear(): void;
  /** Number of active buckets */
  size(): number;
  /** Clean up inactive buckets older than maxAgeMs */
  cleanup?(maxAgeMs?: number): number;
  /** Cleanup timers and resources */
  destroy?(): void;
}

export interface MemoryStoreOptions {
  /** Interval in milliseconds to run automatic cleanup of inactive buckets. Defaults to 60,000 (1 min). Set to 0 to disable. */
  cleanupIntervalMs?: number;
  /** Inactivity threshold in milliseconds before a bucket is eligible for eviction. Defaults to 300,000 (5 mins). */
  maxInactiveAgeMs?: number;
  /** Clock function returning current timestamp in milliseconds (defaults to Date.now). */
  clock?: () => number;
}

interface BucketEntry {
  bucket: TokenBucket;
  lastAccessed: number;
}

/**
 * Highly-performant in-memory store for TokenBucket instances with automatic
 * stale-bucket eviction to prevent memory leaks in production.
 */
export class MemoryStore implements TokenBucketStore {
  private readonly entries: Map<string, BucketEntry> = new Map();
  private readonly maxInactiveAgeMs: number;
  private readonly clock: () => number;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(options: MemoryStoreOptions = {}) {
    const {
      cleanupIntervalMs = 60000,
      maxInactiveAgeMs = 300000,
      clock = () => Date.now(),
    } = options;

    this.maxInactiveAgeMs = maxInactiveAgeMs;
    this.clock = clock;

    if (cleanupIntervalMs > 0) {
      this.cleanupTimer = setInterval(() => {
        this.cleanup(this.maxInactiveAgeMs);
      }, cleanupIntervalMs);

      // Do not keep Node.js event loop alive solely because of the cleanup timer
      if (this.cleanupTimer.unref) {
        this.cleanupTimer.unref();
      }
    }
  }

  public get(key: string): TokenBucket | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }
    entry.lastAccessed = this.clock();
    return entry.bucket;
  }

  public set(key: string, bucket: TokenBucket): void {
    this.entries.set(key, {
      bucket,
      lastAccessed: this.clock(),
    });
  }

  public has(key: string): boolean {
    return this.entries.has(key);
  }

  public delete(key: string): boolean {
    return this.entries.delete(key);
  }

  public clear(): void {
    this.entries.clear();
  }

  public size(): number {
    return this.entries.size;
  }

  /**
   * Manually cleans up entries that have been inactive longer than `maxAgeMs`.
   * @returns Number of evicted buckets.
   */
  public cleanup(maxAgeMs: number = this.maxInactiveAgeMs): number {
    const now = this.clock();
    let evictedCount = 0;

    for (const [key, entry] of this.entries.entries()) {
      if (now - entry.lastAccessed >= maxAgeMs) {
        this.entries.delete(key);
        evictedCount++;
      }
    }

    return evictedCount;
  }

  /**
   * Stops any background cleanup intervals and clears entries.
   */
  public destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    this.entries.clear();
  }
}
