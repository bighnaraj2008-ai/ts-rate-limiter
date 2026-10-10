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

  describe('Token Consumption', () => {
    it('consumes 1 token by default', () => {
      const bucket = new TokenBucket({
        capacity: 5,
        refillRate: 1,
        clock: mockClock,
      });

      expect(bucket.consume()).toBe(true);
      expect(bucket.getTokensRemaining()).toBe(4);
    });

    it('consumes arbitrary number of tokens', () => {
      const bucket = new TokenBucket({
        capacity: 10,
        refillRate: 1,
        clock: mockClock,
      });

      expect(bucket.consume(4)).toBe(true);
      expect(bucket.getTokensRemaining()).toBe(6);
    });

    it('returns false when consuming more tokens than available', () => {
      const bucket = new TokenBucket({
        capacity: 5,
        refillRate: 1,
        clock: mockClock,
      });

      expect(bucket.consume(6)).toBe(false);
      // Tokens should not be deducted if consumption fails
      expect(bucket.getTokensRemaining()).toBe(5);
    });

    it('returns true and deducts nothing when consuming 0 tokens', () => {
      const bucket = new TokenBucket({
        capacity: 5,
        refillRate: 1,
        clock: mockClock,
      });

      expect(bucket.consume(0)).toBe(true);
      expect(bucket.getTokensRemaining()).toBe(5);
    });

    it('throws error for negative or invalid tokens to consume', () => {
      const bucket = new TokenBucket({
        capacity: 5,
        refillRate: 1,
        clock: mockClock,
      });

      expect(() => bucket.consume(-1)).toThrow(RangeError);
      expect(() => bucket.consume(NaN)).toThrow(TypeError);
      // @ts-expect-error Testing non-number input at runtime
      expect(() => bucket.consume('two')).toThrow(TypeError);
    });
  });

  describe('Burst Handling & Edge Cases', () => {
    it('handles burst traffic up to the bucket capacity', () => {
      const capacity = 10;
      const bucket = new TokenBucket({
        capacity,
        refillRate: 1,
        clock: mockClock,
      });

      // Rapidly consume entire burst capacity
      for (let i = 0; i < capacity; i++) {
        expect(bucket.consume(1)).toBe(true);
      }

      // Empty bucket
      expect(bucket.getTokensRemaining()).toBe(0);
      expect(bucket.consume(1)).toBe(false);
    });

    it('allows consuming all tokens at once in a single bulk call', () => {
      const bucket = new TokenBucket({
        capacity: 10,
        refillRate: 1,
        clock: mockClock,
      });

      expect(bucket.consume(10)).toBe(true);
      expect(bucket.getTokensRemaining()).toBe(0);
      expect(bucket.consume(1)).toBe(false);
    });

    it('fails immediately if requesting tokens exceeding total capacity', () => {
      const bucket = new TokenBucket({
        capacity: 10,
        refillRate: 5,
        clock: mockClock,
      });

      expect(bucket.consume(11)).toBe(false);
      expect(bucket.getTokensRemaining()).toBe(10);
    });
  });

  describe('Refill Dynamics Over Time', () => {
    it('refills tokens proportionally based on elapsed time', () => {
      // 2 tokens per second = 1 token per 500ms
      const bucket = new TokenBucket({
        capacity: 10,
        refillRate: 2,
        initialTokens: 0,
        clock: mockClock,
      });

      expect(bucket.getTokensRemaining()).toBe(0);

      // Advance by 500ms -> should have 1 token
      currentTime += 500;
      expect(bucket.getTokensRemaining()).toBe(1);

      // Advance by another 1000ms (total 1500ms) -> should have 3 tokens
      currentTime += 1000;
      expect(bucket.getTokensRemaining()).toBe(3);
    });

    it('does not refill past capacity', () => {
      const bucket = new TokenBucket({
        capacity: 5,
        refillRate: 10,
        clock: mockClock,
      });

      // Advance time by 100 seconds
      currentTime += 100000;
      expect(bucket.getTokensRemaining()).toBe(5);
    });

    it('handles fractional token replenishment during consumption', () => {
      // 1 token per second
      const bucket = new TokenBucket({
        capacity: 5,
        refillRate: 1,
        initialTokens: 0,
        clock: mockClock,
      });

      // 800ms passed -> 0.8 tokens available (not enough for 1 full token)
      currentTime += 800;
      expect(bucket.consume(1)).toBe(false);
      expect(bucket.getTokensRemaining()).toBeCloseTo(0.8);

      // 400ms more (total 1200ms) -> 1.2 tokens available
      currentTime += 400;
      expect(bucket.consume(1)).toBe(true);
      expect(bucket.getTokensRemaining()).toBeCloseTo(0.2);
    });

    it('handles clock moving backwards gracefully without losing or generating tokens', () => {
      const bucket = new TokenBucket({
        capacity: 5,
        refillRate: 1,
        initialTokens: 3,
        clock: mockClock,
      });

      // Clock moves backwards by 10 seconds
      currentTime -= 10000;
      bucket.refill();

      // Tokens should remain unchanged and not corrupted
      expect(bucket.getTokensRemaining()).toBe(3);
    });
  });

  describe('Helper Methods & Header Calculations', () => {
    it('getTimeUntilTokensAvailable calculates exact wait time', () => {
      // 2 tokens per second = 1 token every 500ms
      const bucket = new TokenBucket({
        capacity: 10,
        refillRate: 2,
        initialTokens: 0,
        clock: mockClock,
      });

      // For 1 token deficit at 2 tokens/s: 0.5s = 500ms
      expect(bucket.getTimeUntilTokensAvailable(1)).toBe(500);

      // For 3 tokens deficit: 1.5s = 1500ms
      expect(bucket.getTimeUntilTokensAvailable(3)).toBe(1500);

      // If tokens already available, wait time is 0
      currentTime += 2000; // now has 4 tokens
      expect(bucket.getTimeUntilTokensAvailable(2)).toBe(0);
      expect(bucket.getTimeUntilTokensAvailable(0)).toBe(0);
      expect(bucket.getTimeUntilTokensAvailable(-1)).toBe(0);
    });

    it('getResetTimestampInSeconds returns correct epoch timestamp', () => {
      const bucket = new TokenBucket({
        capacity: 10,
        refillRate: 1, // 1 token/sec
        initialTokens: 0,
        clock: mockClock,
      });

      // currentTime is 1,000,000 ms = 1,000 seconds
      // Need 2 tokens = 2 seconds
      // Expected reset timestamp = 1,002 seconds
      expect(bucket.getResetTimestampInSeconds(2)).toBe(1002);
    });

    it('reset() replenishes bucket immediately to full capacity', () => {
      const bucket = new TokenBucket({
        capacity: 10,
        refillRate: 1,
        initialTokens: 0,
        clock: mockClock,
      });

      expect(bucket.getTokensRemaining()).toBe(0);
      bucket.reset();
      expect(bucket.getTokensRemaining()).toBe(10);
    });
  });
});
