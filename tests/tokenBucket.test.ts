import { TokenBucket } from '../src/tokenBucket';

describe('TokenBucket', () => {
  let currentTime: number;
  const mockClock = () => currentTime;

  beforeEach(() => {
    currentTime = 1000000; // arbitrary base timestamp in ms
  });

  describe('Initialization & Validation', () => {
    it('initializes with object options and default initialTokens equal to capacity', () => {
      const bucket = new TokenBucket({
        capacity: 10,
        refillRate: 2,
        clock: mockClock,
      });

      expect(bucket.capacity).toBe(10);
      expect(bucket.refillRate).toBe(2);
      expect(bucket.getTokensRemaining()).toBe(10);
      expect(bucket.currentTokens).toBe(10);
      expect(bucket.lastUpdated).toBe(currentTime);
      expect(bucket.lastUpdatedTimestamp).toBe(currentTime);
    });

    it('initializes with positional parameters', () => {
      const bucket = new TokenBucket(15, 3, 5, mockClock);

      expect(bucket.capacity).toBe(15);
      expect(bucket.refillRate).toBe(3);
      expect(bucket.getTokensRemaining()).toBe(5);
    });

    it('supports custom initialTokens less than capacity', () => {
      const bucket = new TokenBucket({
        capacity: 10,
        refillRate: 1,
        initialTokens: 3,
        clock: mockClock,
      });

      expect(bucket.getTokensRemaining()).toBe(3);
    });

    it('clamps initialTokens to capacity if initialTokens exceeds capacity', () => {
      const bucket = new TokenBucket({
        capacity: 10,
        refillRate: 1,
        initialTokens: 50,
        clock: mockClock,
      });

      expect(bucket.getTokensRemaining()).toBe(10);
    });

    it('throws RangeError for non-positive or invalid capacity', () => {
      expect(() => new TokenBucket({ capacity: 0, refillRate: 1 })).toThrow(RangeError);
      expect(() => new TokenBucket({ capacity: -5, refillRate: 1 })).toThrow(RangeError);
      expect(() => new TokenBucket({ capacity: NaN, refillRate: 1 })).toThrow(RangeError);
      expect(() => new TokenBucket({ capacity: Infinity, refillRate: 1 })).toThrow(RangeError);
    });

    it('throws RangeError for non-positive or invalid refillRate', () => {
      expect(() => new TokenBucket({ capacity: 10, refillRate: 0 })).toThrow(RangeError);
      expect(() => new TokenBucket({ capacity: 10, refillRate: -2 })).toThrow(RangeError);
      expect(() => new TokenBucket({ capacity: 10, refillRate: NaN })).toThrow(RangeError);
    });

    it('throws RangeError for negative initialTokens', () => {
      expect(() => new TokenBucket({ capacity: 10, refillRate: 1, initialTokens: -1 })).toThrow(
        RangeError
      );
    });

    it('uses Date.now by default when no clock is provided', () => {
      const before = Date.now();
      const bucket = new TokenBucket({ capacity: 10, refillRate: 1 });
      const after = Date.now();

      expect(bucket.lastUpdated).toBeGreaterThanOrEqual(before);
      expect(bucket.lastUpdated).toBeLessThanOrEqual(after);
    });
  });
});
